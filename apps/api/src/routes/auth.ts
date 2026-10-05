import { Hono } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"
import { z } from "zod"
import { createAttemptLimiter, MAX_CODE_ATTEMPTS } from "../auth/attempts"
import { buildAuthUrl, exchangeCode } from "../auth/google"
import { type AppEnv, requirePending2fa } from "../auth/middleware"
import {
  clearSessionCookie,
  createSession,
  deleteSessionFromRequest,
  setSessionCookie,
} from "../auth/session"
import { verifyTotp } from "../auth/totp"
import { findOrCreateUser, toUserJson } from "../auth/users"
import { googleEnabled } from "../config"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"

const OAUTH_COOKIE = "intesa_oauth"
const OAUTH_PATH = "/api/auth/google"

const devLoginBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(100).optional(),
})
export const codeBody = z.object({ code: z.string().regex(/^\d{6}$/, "Code must be 6 digits") })

export function authRoutes({ db, config }: Deps) {
  const attempts = createAttemptLimiter(MAX_CODE_ATTEMPTS, 0)
  // Checked before body validation so a disabled endpoint reveals nothing.
  const devLoginGate = createMiddleware(async (_c, next) => {
    if (!config.devLogin) throw new ApiError("NOT_FOUND", "Not found")
    await next()
  })

  return new Hono<AppEnv>()
    .get("/config", (c) => c.json({ google: googleEnabled(config), devLogin: config.devLogin }))
    .post("/dev-login", devLoginGate, validate("json", devLoginBody), async (c) => {
      const { email, name } = c.req.valid("json")
      const user = await findOrCreateUser(db, { email, name })
      const pending = user.totpEnabled === 1
      setSessionCookie(c, await createSession(db, user.id, pending), config)
      if (pending) return c.json({ twoFactorRequired: true as const }, 200)
      return c.json({ user: toUserJson(user) }, 200)
    })
    .get("/google/start", async (c) => {
      if (!googleEnabled(config)) return c.redirect("/login?error=google_unavailable")
      const { url, state, verifier } = await buildAuthUrl(config)
      setCookie(c, OAUTH_COOKIE, `${state}.${verifier}`, {
        httpOnly: true,
        sameSite: "Lax",
        secure: config.secureCookies,
        path: OAUTH_PATH,
        maxAge: 600,
      })
      return c.redirect(url)
    })
    .get("/google/callback", async (c) => {
      const stored = getCookie(c, OAUTH_COOKIE)
      deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_PATH, secure: config.secureCookies })
      const fail = (code: string) => c.redirect(`/login?error=${code}`)

      const [state, verifier] = stored?.split(".") ?? []
      if (!googleEnabled(config)) return fail("google_unavailable")
      if (!state || !verifier || state !== c.req.query("state")) return fail("state_mismatch")
      if (c.req.query("error")) return fail("access_denied")
      const code = c.req.query("code")
      if (!code) return fail("missing_code")

      try {
        const profile = await exchangeCode(config, code, verifier)
        const user = await findOrCreateUser(db, {
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
          googleSub: profile.sub,
        })
        const pending = user.totpEnabled === 1
        setSessionCookie(c, await createSession(db, user.id, pending), config)
        return c.redirect(pending ? "/login/2fa" : "/")
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "google sign-in", error: String(err) }))
        return fail("google_failed")
      }
    })
    .post("/2fa", requirePending2fa(db), validate("json", codeBody), async (c) => {
      const user = c.var.user
      const { code } = c.req.valid("json")
      const { tokenHash } = c.var.session
      if (!user.totpSecret || !(await verifyTotp(user.totpSecret, code))) {
        if (attempts.fail(tokenHash)) {
          // Too many guesses: the sign-in is abandoned and must start over.
          await db.deleteFrom("sessions").where("tokenHash", "=", tokenHash).execute()
          attempts.reset(tokenHash)
          throw new ApiError("UNAUTHORIZED", "Too many attempts, sign in again")
        }
        throw new ApiError("VALIDATION_ERROR", "Invalid code")
      }
      attempts.reset(tokenHash)
      await db
        .updateTable("sessions")
        .set({ pendingTwoFactor: 0 })
        .where("tokenHash", "=", c.var.session.tokenHash)
        .execute()
      return c.json({ user: toUserJson(user) })
    })
    .post("/logout", async (c) => {
      await deleteSessionFromRequest(db, c)
      clearSessionCookie(c, config)
      return c.body(null, 204)
    })
}
