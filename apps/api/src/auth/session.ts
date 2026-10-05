import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import type { Selectable } from "kysely"
import type { Config } from "../config"
import { type Db, now } from "../db"
import type { UserTable } from "../db/schema"

export const SESSION_COOKIE = "intesa_session"
const SESSION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export type User = Selectable<UserTable>
export type SessionInfo = { tokenHash: string; pendingTwoFactor: boolean }

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url")

export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return Buffer.from(digest).toString("hex")
}

export async function createSession(db: Db, userId: string, pendingTwoFactor: boolean): Promise<string> {
  const token = randomToken()
  await db
    .insertInto("sessions")
    .values({
      tokenHash: await hashToken(token),
      userId,
      pendingTwoFactor: pendingTwoFactor ? 1 : 0,
      expiresAt: new Date(Date.now() + SESSION_DAYS * DAY_MS).toISOString(),
      createdAt: now(),
    })
    .execute()
  return token
}

export function setSessionCookie(c: Context, token: string, config: Config) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.secureCookies,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
}

export function clearSessionCookie(c: Context, config: Config) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: config.secureCookies })
}

// Resolves the request's session, extending its expiry (at most once a day) so active
// users stay signed in. Expired sessions are removed.
export async function loadSession(
  db: Db,
  c: Context,
): Promise<{ user: User; session: SessionInfo } | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const tokenHash = await hashToken(token)

  const row = await db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.userId")
    .selectAll("users")
    .select(["sessions.pendingTwoFactor", "sessions.expiresAt as sessionExpiresAt"])
    .where("sessions.tokenHash", "=", tokenHash)
    .executeTakeFirst()
  if (!row) return null

  const { pendingTwoFactor, sessionExpiresAt, ...user } = row
  if (sessionExpiresAt <= now()) {
    await db.deleteFrom("sessions").where("tokenHash", "=", tokenHash).execute()
    return null
  }
  if (Date.parse(sessionExpiresAt) < Date.now() + (SESSION_DAYS - 1) * DAY_MS) {
    await db
      .updateTable("sessions")
      .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * DAY_MS).toISOString() })
      .where("tokenHash", "=", tokenHash)
      .execute()
  }
  return { user, session: { tokenHash, pendingTwoFactor: pendingTwoFactor === 1 } }
}

export async function deleteSessionFromRequest(db: Db, c: Context) {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return
  await db
    .deleteFrom("sessions")
    .where("tokenHash", "=", await hashToken(token))
    .execute()
}
