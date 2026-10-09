import type { Context } from "hono"
import { createMiddleware } from "hono/factory"
import type { Db } from "../db"
import { ApiError } from "../lib/errors"
import { type CookieSession, loadSession, type SessionInfo, type User } from "./session"
import { bearerToken, loadTokenSession } from "./tokens"

export type AppEnv = { Variables: { user: User; session: SessionInfo } }

const READ_METHODS = new Set(["GET", "HEAD"])

// A Bearer header wins over the cookie, and a bad bearer token never falls back to it: a
// client that sends one means to act as that token, not as whoever the browser is signed in as.
function authenticate(db: Db, c: Context) {
  const bearer = bearerToken(c)
  return bearer === undefined ? loadSession(db, c) : loadTokenSession(db, bearer)
}

// Full access: a signed-in user who has completed 2FA if it is enabled. Read-scope tokens
// are refused on anything but GET/HEAD, unless the route opts out with `anyScope` (signing a
// token out has to work for read-only tokens too).
export const requireUser = (db: Db, { anyScope = false } = {}) =>
  createMiddleware<AppEnv>(async (c, next) => {
    // Several routers share a mount point and each installs this; resolve the session once.
    // A session another guard stored as pending 2FA never counts as a full sign-in.
    if (!(c.var.user && c.var.session?.pendingTwoFactor === false)) {
      const found = await authenticate(db, c)
      if (!found) throw new ApiError("UNAUTHORIZED", "Sign in required")
      if (found.session.pendingTwoFactor) {
        throw new ApiError("TWO_FACTOR_REQUIRED", "Two-factor code required")
      }
      c.set("user", found.user)
      c.set("session", found.session)
    }
    const session = c.var.session
    if (
      !anyScope &&
      session.kind === "token" &&
      session.scope === "read" &&
      !READ_METHODS.has(c.req.method)
    ) {
      throw new ApiError("FORBIDDEN", "This token is read-only")
    }
    await next()
  })

// Only for the TOTP verification step, which is the one thing a pending session may do.
// Only browser sessions can be pending, so a bearer request is simply "not pending".
export const requirePending2fa = (db: Db) =>
  createMiddleware<{ Variables: { user: User; session: CookieSession } }>(async (c, next) => {
    // Several routers share a mount point and each installs this; resolve the session once.
    if (c.var.user && c.var.session?.pendingTwoFactor === true) return next()
    const found = await authenticate(db, c)
    if (!found) throw new ApiError("UNAUTHORIZED", "Sign in required")
    if (found.session.kind !== "cookie" || !found.session.pendingTwoFactor) {
      throw new ApiError("VALIDATION_ERROR", "Two-factor verification is not pending")
    }
    c.set("user", found.user)
    c.set("session", found.session)
    await next()
  })
