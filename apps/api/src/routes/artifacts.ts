import { unzipSync } from "fflate"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { artifactFileError, artifactFormat, MAX_ARTIFACT_BYTES } from "../artifacts/formats"
import type { AppEnv } from "../auth/middleware"
import { newId, now } from "../db"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { requireTask } from "../tasks/service"

const metadata = ["id", "name", "mimeType", "size", "createdAt", "updatedAt"] as const

async function readFile(req: Request) {
  let form: Awaited<ReturnType<Request["formData"]>>
  try {
    form = await req.formData()
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Upload a file using multipart/form-data.")
  }
  const file = form.get("file")
  if (!(file instanceof File) || form.getAll("file").length !== 1)
    throw new ApiError("VALIDATION_ERROR", "Upload exactly one artifact at a time.")
  const error = artifactFileError(file)
  if (error) throw new ApiError("VALIDATION_ERROR", error)
  const format = artifactFormat(file.name)
  if (!format) throw new ApiError("VALIDATION_ERROR", "Unsupported artifact format.")
  const mimeType = format.mime
  const content = Buffer.from(await file.arrayBuffer())
  // Reject renamed binaries and corrupt binary headers; never trust a supplied MIME alone.
  let valid = true
  if (mimeType === "application/pdf") valid = content.subarray(0, 5).toString() === "%PDF-"
  else if (mimeType === "application/msword")
    valid =
      content.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")) &&
      content.includes(Buffer.from("WordDocument", "utf16le"))
  else if (mimeType.startsWith("application/")) {
    try {
      // Inspect the container without expanding document bodies or embedded media.
      const names = new Set<string>()
      const entries = unzipSync(content, {
        filter: (entry) => {
          names.add(entry.name)
          return entry.name === "mimetype" && entry.originalSize < 256
        },
      })
      valid = mimeType.includes("wordprocessingml")
        ? names.has("word/document.xml") && names.has("[Content_Types].xml")
        : names.has("content.xml") && new TextDecoder().decode(entries.mimetype) === mimeType
    } catch {
      valid = false
    }
  } else {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(content)
      valid = !text.includes("\0")
    } catch {
      valid = false
    }
  }
  if (!valid) throw new ApiError("VALIDATION_ERROR", "The file content does not match its format.")
  return { name: file.name, mimeType, size: file.size, content }
}

// Mounted under taskRoutes, which authenticates before any task-scoped handler.
export function artifactRoutes({ db }: Pick<Deps, "db">) {
  return new Hono<AppEnv>()
    .use(
      "*",
      bodyLimit({
        // Leave room for multipart headers, while checking the actual file size separately.
        maxSize: MAX_ARTIFACT_BYTES + 64 * 1024,
        onError: () => {
          throw new ApiError("VALIDATION_ERROR", "Artifacts must be 5 MB or smaller.")
        },
      }),
    )
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
      const artifact = await db
        .insertInto("artifacts")
        .values({
          ...file,
          id: newId(),
          taskId: task.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning(metadata)
        .executeTakeFirstOrThrow()
      return c.json({ artifact }, 201)
    })
    .get("/:taskId/artifacts/:artifactId", async (c) => {
      await requireTask(db, c.var.user.id, c.req.param("taskId"))
      const artifact = await db
        .selectFrom("artifacts")
        .selectAll()
        .where("taskId", "=", c.req.param("taskId"))
        .where("id", "=", c.req.param("artifactId"))
        .executeTakeFirst()
      if (!artifact) throw new ApiError("NOT_FOUND", "Artifact not found")
      return new Response(new Uint8Array(artifact.content), {
        headers: {
          "Content-Type": artifact.mimeType.startsWith("text/")
            ? `${artifact.mimeType}; charset=utf-8`
            : artifact.mimeType,
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
          "Content-Length": String(artifact.size),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          // HTML needs isolation; sandboxing PDFs would disable browser PDF viewers/downloads.
          ...(artifact.mimeType === "text/html"
            ? {
                "Content-Security-Policy":
                  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
              }
            : {}),
        },
      })
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
      const artifact = await db
        .updateTable("artifacts")
        .set({ ...file, updatedAt: now() })
        .where("id", "=", existing.id)
        .returning(metadata)
        .executeTakeFirstOrThrow()
      return c.json({ artifact })
    })
}
