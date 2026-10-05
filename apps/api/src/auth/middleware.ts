import { createMiddleware } from "hono/factory"
import type { Db } from "../db"
import { ApiError } from "../lib/errors"
import { loadSession, type SessionInfo, type User } from "./session"

export type AppEnv = { Variables: { user: User; session: SessionInfo } }

// Full access: a signed-in user who has completed 2FA if it is enabled.
export const requireUser = (db: Db) =>
  createMiddleware<AppEnv>(async (c, next) => {
    // Several routers share a mount point and each installs this; resolve the session once.
    if (c.var.user) return next()
    const found = await loadSession(db, c)
    if (!found) throw new ApiError("UNAUTHORIZED", "Sign in required")
    if (found.session.pendingTwoFactor) {
      throw new ApiError("TWO_FACTOR_REQUIRED", "Two-factor code required")
    }
    c.set("user", found.user)
    c.set("session", found.session)
    await next()
  })

// Only for the TOTP verification step, which is the one thing a pending session may do.
export const requirePending2fa = (db: Db) =>
  createMiddleware<AppEnv>(async (c, next) => {
    // Several routers share a mount point and each installs this; resolve the session once.
    if (c.var.user) return next()
    const found = await loadSession(db, c)
    if (!found) throw new ApiError("UNAUTHORIZED", "Sign in required")
    if (!found.session.pendingTwoFactor) {
      throw new ApiError("VALIDATION_ERROR", "Two-factor verification is not pending")
    }
    c.set("user", found.user)
    c.set("session", found.session)
    await next()
  })
