import { Hono } from "hono"
import { fileResponse, readFile, storeBlob, uploadLimit } from "../artifacts/files"
import type { AppEnv } from "../auth/middleware"
import { inTransaction, newId, now } from "../db"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { requireTask } from "../tasks/service"

const metadata = ["id", "name", "mimeType", "size", "createdAt", "updatedAt"] as const

// Mounted under taskRoutes, which authenticates before any task-scoped handler.
export function artifactRoutes({ db }: Pick<Deps, "db">) {
  return new Hono<AppEnv>()
    .use("*", uploadLimit)
    .get("/:taskId/artifacts", async (c) => {
      await requireTask(db, c.var.user.id, c.req.param("taskId"))
      const artifacts = await db
        .selectFrom("artifacts")
        .select(metadata)
        .where("taskId", "=", c.req.param("taskId"))
        .orderBy("createdAt")
        .orderBy("id")
        .execute()
      return c.json({ artifacts })
    })
    .post("/:taskId/artifacts", async (c) => {
      const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
      const file = await readFile(c.req.raw)
      const timestamp = now()
      const artifact = await inTransaction(db, async (trx) =>
        trx
          .insertInto("artifacts")
          .values({
            id: newId(),
            taskId: task.id,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
            blobHash: await storeBlob(trx, file),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning(metadata)
          .executeTakeFirstOrThrow(),
      )
      return c.json({ artifact }, 201)
    })
    .get("/:taskId/artifacts/:artifactId", async (c) => {
      await requireTask(db, c.var.user.id, c.req.param("taskId"))
      const artifact = await db
        .selectFrom("artifacts")
        .innerJoin("blobs", "blobs.hash", "artifacts.blobHash")
        .select(["artifacts.name", "artifacts.mimeType", "artifacts.size", "blobs.content"])
        .where("artifacts.taskId", "=", c.req.param("taskId"))
        .where("artifacts.id", "=", c.req.param("artifactId"))
        .executeTakeFirst()
      if (!artifact) throw new ApiError("NOT_FOUND", "Artifact not found")
      return fileResponse(artifact)
    })
    .put("/:taskId/artifacts/:artifactId", async (c) => {
      await requireTask(db, c.var.user.id, c.req.param("taskId"))
      const existing = await db
        .selectFrom("artifacts")
        .select(["id", "name", "mimeType"])
        .where("taskId", "=", c.req.param("taskId"))
        .where("id", "=", c.req.param("artifactId"))
        .executeTakeFirst()
      if (!existing) throw new ApiError("NOT_FOUND", "Artifact not found")
      if (existing.mimeType !== "text/markdown")
        throw new ApiError("VALIDATION_ERROR", "Only Markdown artifacts can be edited.")
      const file = await readFile(c.req.raw)
      if (file.mimeType !== "text/markdown" || file.name !== existing.name)
        throw new ApiError(
          "VALIDATION_ERROR",
          "Replace this artifact with Markdown using the same filename.",
        )
      // The trigger on artifacts deletes the old blob if nothing else refers to it.
      const artifact = await inTransaction(db, async (trx) =>
        trx
          .updateTable("artifacts")
          .set({ size: file.size, blobHash: await storeBlob(trx, file), updatedAt: now() })
          .where("id", "=", existing.id)
          .returning(metadata)
          .executeTakeFirstOrThrow(),
      )
      return c.json({ artifact })
    })
    .delete("/:taskId/artifacts/:artifactId", async (c) => {
      await requireTask(db, c.var.user.id, c.req.param("taskId"))
      const deleted = await db
        .deleteFrom("artifacts")
        .where("taskId", "=", c.req.param("taskId"))
        .where("id", "=", c.req.param("artifactId"))
        .executeTakeFirst()
      if (Number(deleted.numDeletedRows) === 0)
        throw new ApiError("NOT_FOUND", "Artifact not found")
      return c.body(null, 204)
    })
}
