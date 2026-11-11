import { createHash } from "node:crypto"
import { unzipSync } from "fflate"
import { bodyLimit } from "hono/body-limit"
import type { Db } from "../db"
import { ApiError } from "../lib/errors"
import { artifactFileError, artifactFormat, isImage, MAX_IMAGE_BYTES } from "./formats"

// Uploads of artifacts and bug images: reading and checking a file, storing its bytes, and
// serving them back.

export const uploadLimit = bodyLimit({
  // Leave room for multipart headers, while checking each format's own limit separately.
  maxSize: MAX_IMAGE_BYTES + 64 * 1024,
  onError: () => {
    throw new ApiError("VALIDATION_ERROR", "Files must be 10 MB or smaller.")
  },
})

const imageSignatures: Record<string, (content: Buffer) => boolean> = {
  "image/png": (c) => c.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  "image/jpeg": (c) => c.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
  "image/gif": (c) => ["GIF87a", "GIF89a"].includes(c.subarray(0, 6).toString("latin1")),
  "image/webp": (c) =>
    c.subarray(0, 4).toString("latin1") === "RIFF" &&
    c.subarray(8, 12).toString("latin1") === "WEBP",
}

export async function readFile(req: Request) {
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
  if (isImage(mimeType)) valid = imageSignatures[mimeType]?.(content) ?? false
  else if (mimeType === "application/pdf") valid = content.subarray(0, 5).toString() === "%PDF-"
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

export type ArtifactFile = Awaited<ReturnType<typeof readFile>>

// Stores the bytes once per distinct content and returns the hash a handle refers to them by.
export async function storeBlob(trx: Db, { size, content }: ArtifactFile) {
  const hash = createHash("sha256").update(content).digest("hex")
  await trx
    .insertInto("blobs")
    .values({ hash, size, content })
    .onConflict((oc) => oc.column("hash").doNothing())
    .execute()
  return hash
}

type StoredFile = { name: string; mimeType: string; size: number; content: Uint8Array }

// Serves stored bytes inline, with headers that keep active content from running.
export function fileResponse(file: StoredFile) {
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mimeType.startsWith("text/")
        ? `${file.mimeType}; charset=utf-8`
        : file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Content-Length": String(file.size),
      // Only Markdown is ever replaced, so an image's bytes never change under its id.
      "Cache-Control": isImage(file.mimeType) ? "private, max-age=86400" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // HTML needs isolation; sandboxing PDFs would disable browser PDF viewers/downloads.
      ...(file.mimeType === "text/html"
        ? {
            "Content-Security-Policy":
              "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
          }
        : {}),
    },
  })
}
