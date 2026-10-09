import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import type { Updateable } from "kysely"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { generateSecret, otpauthUrl, verifyTotp } from "../auth/totp"
import { toUserJson } from "../auth/users"
import { now } from "../db"
import type { UserTable } from "../db/schema"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"
import { codeBody } from "./auth"

const patchBody = z.object({ name: z.string().trim().min(1).max(100) })

// A leaked token must not be able to put 2FA on the account with a secret of its choosing and
// lock the owner out. Turning 2FA off stays open to tokens: it needs a current code.
const browserOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.session.kind !== "cookie") {
    throw new ApiError("FORBIDDEN", "Two-factor setup must be done in the web app")
  }
  await next()
})

export function meRoutes({ db, attempts }: Deps) {
  // Wrong codes count against the user; too many in a row locks code entry for a while.
  const checkCode = async (user: { id: string; totpSecret: string | null }, code: string) => {
    if (attempts.take(user.id) === "locked") {
      throw new ApiError("RATE_LIMITED", "Too many attempts, try again later")
    }
    if (!user.totpSecret || !(await verifyTotp(user.totpSecret, code))) {
      throw new ApiError("VALIDATION_ERROR", "Invalid code")
    }
    attempts.reset(user.id)
  }
  const updateUser = (id: string, set: Updateable<UserTable>) =>
    db
      .updateTable("users")
      .set({ ...set, updatedAt: now() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow()

  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/", (c) => c.json({ user: toUserJson(c.var.user) }))
    .patch("/", validate("json", patchBody), async (c) => {
      const { name } = c.req.valid("json")
      return c.json({ user: toUserJson(await updateUser(c.var.user.id, { name })) })
    })
    .post("/2fa/setup", browserOnly, async (c) => {
      const user = c.var.user
      if (user.totpEnabled === 1) {
        throw new ApiError("CONFLICT", "Two-factor authentication is already enabled")
      }
      const secret = generateSecret()
      await updateUser(user.id, { totpSecret: secret })
      return c.json({ secret, otpauthUrl: otpauthUrl(secret, user.email) })
    })
    .post("/2fa/enable", browserOnly, validate("json", codeBody), async (c) => {
      const user = c.var.user
      const { code } = c.req.valid("json")
      if (!user.totpSecret) {
        throw new ApiError("VALIDATION_ERROR", "Start two-factor setup first")
      }
      await checkCode(user, code)
      return c.json({ user: toUserJson(await updateUser(user.id, { totpEnabled: 1 })) })
    })
    .post("/2fa/disable", validate("json", codeBody), async (c) => {
      const user = c.var.user
      const { code } = c.req.valid("json")
      if (user.totpEnabled !== 1 || !user.totpSecret) {
        throw new ApiError("VALIDATION_ERROR", "Two-factor authentication is not enabled")
      }
      await checkCode(user, code)
      return c.json({
        user: toUserJson(await updateUser(user.id, { totpEnabled: 0, totpSecret: null })),
      })
    })
}
