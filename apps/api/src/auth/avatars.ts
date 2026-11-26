import { bodyLimit } from "hono/body-limit"
import { sniffImage } from "../artifacts/files"
import { type Db, inTransaction, now } from "../db"
import { ApiError } from "../lib/errors"

// Avatars people upload for themselves. The bytes are kept in `userAvatars`; `users.avatarUrl`
// points at them, with the upload time as a version so a new avatar is a new URL that every
// cache fetches afresh. Removing one falls back to the Google picture (`googleAvatarUrl`).

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const TOO_BIG = "Avatars must be 2 MB or smaller."

export const avatarUploadLimit = bodyLimit({
  // Leave room for multipart headers; the file itself is checked against the limit below.
  maxSize: MAX_AVATAR_BYTES + 64 * 1024,
  onError: () => {
    throw new ApiError("VALIDATION_ERROR", TOO_BIG)
  },
})

export const avatarVersion = (updatedAt: string) => Date.parse(updatedAt).toString(36)

export const avatarPath = (userId: string, updatedAt: string) =>
  `/api/users/${encodeURIComponent(userId)}/avatar?v=${avatarVersion(updatedAt)}`

// A single PNG, JPEG, GIF or WebP, recognised by its bytes rather than its name or MIME type.
// SVG is refused: it can carry script.
export async function readAvatar(req: Request) {
  let form: Awaited<ReturnType<Request["formData"]>>
  try {
    form = await req.formData()
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Upload an image using multipart/form-data.")
  }
  const file = form.get("file")
  if (!(file instanceof File) || form.getAll("file").length !== 1)
    throw new ApiError("VALIDATION_ERROR", "Upload exactly one image.")
  if (file.size > MAX_AVATAR_BYTES) throw new ApiError("VALIDATION_ERROR", TOO_BIG)
  const content = Buffer.from(await file.arrayBuffer())
  const mimeType = sniffImage(content)
  if (!mimeType)
    throw new ApiError("VALIDATION_ERROR", "Avatars must be PNG, JPEG, GIF or WebP images.")
  return { mimeType, content }
}

export function setAvatar(db: Db, userId: string, avatar: { mimeType: string; content: Buffer }) {
  const updatedAt = now()
  const row = { ...avatar, size: avatar.content.length, updatedAt }
  return inTransaction(db, async (trx) => {
    await trx
      .insertInto("userAvatars")
      .values({ userId, ...row })
      .onConflict((oc) => oc.column("userId").doUpdateSet(row))
      .execute()
    return trx
      .updateTable("users")
      .set({ avatarUrl: avatarPath(userId, updatedAt), updatedAt })
      .where("id", "=", userId)
      .returningAll()
      .executeTakeFirstOrThrow()
  })
}

export function removeAvatar(db: Db, userId: string) {
  return inTransaction(db, async (trx) => {
    await trx.deleteFrom("userAvatars").where("userId", "=", userId).execute()
    return trx
      .updateTable("users")
      .set((eb) => ({ avatarUrl: eb.ref("googleAvatarUrl"), updatedAt: now() }))
      .where("id", "=", userId)
      .returningAll()
      .executeTakeFirstOrThrow()
  })
}

export const hasUploadedAvatar = async (db: Db, userId: string) =>
  Boolean(
    await db
      .selectFrom("userAvatars")
      .select("userId")
      .where("userId", "=", userId)
      .executeTakeFirst(),
  )
