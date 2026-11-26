import { Hono } from "hono"
import { avatarVersion } from "../auth/avatars"
import { type AppEnv, requireUser } from "../auth/middleware"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"

// Avatars are shown wherever people are (members, assignees, history), so any signed-in user
// may load anyone's.
export function userRoutes({ db }: Pick<Deps, "db">) {
  return new Hono<AppEnv>().use(requireUser(db)).get("/:userId/avatar", async (c) => {
    const avatar = await db
      .selectFrom("userAvatars")
      .select(["mimeType", "size", "content", "updatedAt"])
      .where("userId", "=", c.req.param("userId"))
      .executeTakeFirst()
    if (!avatar) throw new ApiError("NOT_FOUND", "Avatar not found")
    // A new upload gets a new version in the URL, so the current version's bytes never change
    // and may be kept; any other URL must check back.
    const current = c.req.query("v") === avatarVersion(avatar.updatedAt)
    return new Response(new Uint8Array(avatar.content), {
      headers: {
        "Content-Type": avatar.mimeType,
        "Content-Length": String(avatar.size),
        "Cache-Control": current ? "private, max-age=31536000, immutable" : "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    })
  })
}
