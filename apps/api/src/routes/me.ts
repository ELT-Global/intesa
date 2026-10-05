import { Hono } from "hono"
import type { Updateable } from "kysely"
import { z } from "zod"
import { createAttemptLimiter, LOCKOUT_MS, MAX_CODE_ATTEMPTS } from "../auth/attempts"
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

export function meRoutes({ db }: Deps) {
  const attempts = createAttemptLimiter(MAX_CODE_ATTEMPTS, LOCKOUT_MS)
  // Wrong codes count against the user; too many in a row locks code entry for a while.
  const checkCode = async (user: { id: string; totpSecret: string | null }, code: string) => {
    if (attempts.isLocked(user.id)) {
      throw new ApiError("RATE_LIMITED", "Too many attempts, try again later")
    }
    if (!user.totpSecret || !(await verifyTotp(user.totpSecret, code))) {
      attempts.fail(user.id)
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
    .post("/2fa/setup", async (c) => {
      const user = c.var.user
      if (user.totpEnabled === 1) {
        throw new ApiError("CONFLICT", "Two-factor authentication is already enabled")
      }
      const secret = generateSecret()
      await updateUser(user.id, { totpSecret: secret })
      return c.json({ secret, otpauthUrl: otpauthUrl(secret, user.email) })
    })
    .post("/2fa/enable", validate("json", codeBody), async (c) => {
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
