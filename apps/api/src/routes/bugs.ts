import { Hono } from "hono"
import { fileResponse, readFile, storeBlob, uploadLimit } from "../artifacts/files"
import { isImage } from "../artifacts/formats"
import { deleteDroppedBugImages } from "../artifacts/images"
import { type AppEnv, requireUser } from "../auth/middleware"
import { listBugsQuery, patchBugBody, regressionTaskBody } from "../bugs/schemas"
import {
  findBugIdByKey,
  listProjectBugs,
  loadBug,
  openRegression,
  requireBug,
} from "../bugs/service"
import { inTransaction, newId, now } from "../db"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"
import { requireProject } from "../projects/service"
import { loadTaskSummaries } from "../tasks/service"
import { requireMembership } from "../workspaces/membership"

export function projectBugRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/:projectId/bugs", validate("query", listBugsQuery), async (c) => {
      const { project } = await requireProject(db, c.var.user.id, c.req.param("projectId"))
      return c.json({ bugs: await listProjectBugs(db, project.id, c.req.valid("query").status) })
    })
}

// For clients that know a bug by its key (WEB-B3).
export function workspaceBugRoutes({ db }: Deps) {
  return new Hono<AppEnv>().use(requireUser(db)).get("/:workspaceId/bugs/:key", async (c) => {
    const workspaceId = c.req.param("workspaceId")
    await requireMembership(db, c.var.user.id, workspaceId)
    const id = await findBugIdByKey(db, workspaceId, c.req.param("key"))
    if (!id) throw new ApiError("NOT_FOUND", "Bug not found")
    return c.json({ bug: await loadBug(db, id) })
  })
}

export function bugRoutes({ db }: Deps) {
  return (
    new Hono<AppEnv>()
      .use(requireUser(db))
      .get("/:bugId", async (c) => {
        const bug = await requireBug(db, c.var.user.id, c.req.param("bugId"))
        return c.json({ bug: await loadBug(db, bug.id) })
      })
      .patch("/:bugId", validate("json", patchBugBody), async (c) => {
        const bug = await requireBug(db, c.var.user.id, c.req.param("bugId"))
        const patch = c.req.valid("json")
        if (patch.title !== undefined || patch.body !== undefined) {
          await inTransaction(db, async (trx) => {
            if (patch.body !== undefined) await deleteDroppedBugImages(trx, bug.id, patch.body)
            const ts = now()
            // Once edited, the bug stops following its first task.
            await trx
              .updateTable("bugs")
              .set({
                ...(patch.title !== undefined && { title: patch.title }),
                ...(patch.body !== undefined && { body: patch.body }),
                editedAt: ts,
                updatedAt: ts,
              })
              .where("id", "=", bug.id)
              .execute()
          })
        }
        return c.json({ bug: await loadBug(db, bug.id) })
      })
      .post("/:bugId/tasks", validate("json", regressionTaskBody), async (c) => {
        const bug = await requireBug(db, c.var.user.id, c.req.param("bugId"))
        const id = await openRegression(db, c.var.user.id, bug, c.req.valid("json"))
        const [task] = await loadTaskSummaries(db, [id])
        return c.json(
          { task: task as NonNullable<typeof task>, bug: await loadBug(db, bug.id) },
          201,
        )
      })
      .post("/:bugId/images", uploadLimit, async (c) => {
        const bug = await requireBug(db, c.var.user.id, c.req.param("bugId"))
        const file = await readFile(c.req.raw)
        if (!isImage(file.mimeType))
          throw new ApiError("VALIDATION_ERROR", "Bugs take images only: PNG, JPEG, GIF or WebP.")
        const image = await inTransaction(db, async (trx) =>
          trx
            .insertInto("bugImages")
            .values({
              id: newId(),
              bugId: bug.id,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
              blobHash: await storeBlob(trx, file),
              createdAt: now(),
            })
            .returning(["id", "name", "mimeType", "size"])
            .executeTakeFirstOrThrow(),
        )
        return c.json({ image }, 201)
      })
      .get("/:bugId/images/:imageId", async (c) => {
        const bug = await requireBug(db, c.var.user.id, c.req.param("bugId"))
        const image = await db
          .selectFrom("bugImages")
          .innerJoin("blobs", "blobs.hash", "bugImages.blobHash")
          .select(["bugImages.name", "bugImages.mimeType", "bugImages.size", "blobs.content"])
          .where("bugImages.bugId", "=", bug.id)
          .where("bugImages.id", "=", c.req.param("imageId"))
          .executeTakeFirst()
        if (!image) throw new ApiError("NOT_FOUND", "Image not found")
        return fileResponse(image)
      })
      // For images pasted and taken out again before the description saved, which the body
      // clean-up never sees.
      .delete("/:bugId/images/:imageId", async (c) => {
        const bug = await requireBug(db, c.var.user.id, c.req.param("bugId"))
        const deleted = await db
          .deleteFrom("bugImages")
          .where("bugId", "=", bug.id)
          .where("id", "=", c.req.param("imageId"))
          .executeTakeFirst()
        if (Number(deleted.numDeletedRows) === 0) throw new ApiError("NOT_FOUND", "Image not found")
        return c.body(null, 204)
      })
  )
}
