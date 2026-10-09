import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { hashToken, randomToken } from "../auth/session"
import { cliTokenExpiry, createApiToken } from "../auth/tokens"
import { toUserJson } from "../auth/users"
import { inTransaction, isUniqueViolation, now } from "../db"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"

// Device sign-in in the shape of OAuth device authorization (RFC 8628): the CLI starts a
// request and polls with the device code while the person enters the user code in the web
// app, where Google sign-in and 2FA already apply.

const EXPIRES_IN_S = 10 * 60
const INTERVAL_S = 5
// Starting a request needs no sign-in, so the table is capped. Far more than real use: each
// request lives ten minutes.
const MAX_PENDING = 1000
// Consonants only (RFC 8628's suggestion): no vowels to spell words, no 0/O or 1/I mix-ups.
const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"
const USER_CODE = new RegExp(`^[${ALPHABET}]{8}$`)

// Uniform over the alphabet: bytes beyond its last whole multiple are drawn again.
function randomUserCode(): string {
  const limit = 256 - (256 % ALPHABET.length)
  let code = ""
  while (code.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && code.length < 8) code += ALPHABET[byte % ALPHABET.length]
    }
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

// People type the code in any case, with or without the dash.
function normalizeUserCode(input: string): string | null {
  const letters = input.toUpperCase().replace(/[\s-]/g, "")
  return USER_CODE.test(letters) ? `${letters.slice(0, 4)}-${letters.slice(4)}` : null
}

// The client name becomes the token name, so it has the same limit as personal token names.
const startBody = z.object({ clientName: z.string().trim().min(1).max(100) })
const pollBody = z.object({ deviceCode: z.string().min(1).max(200) })

export function deviceRoutes({ db, config, attempts }: Deps) {
  const verificationUri = `${config.publicUrl}/device`

  // User codes are short enough to guess, so misses draw on the same kind of per-user budget
  // as 2FA codes (under their own key, so a typo here cannot lock someone out of 2FA). A hit
  // hands its try back rather than clearing the misses: anyone can start a request and hold
  // a valid code, which would otherwise buy unlimited guesses.
  const findPending = async (userId: string, input: string) => {
    const key = `device:${userId}`
    if (attempts.take(key) === "locked") {
      throw new ApiError("RATE_LIMITED", "Too many attempts, try again later")
    }
    const userCode = normalizeUserCode(input)
    const row =
      userCode &&
      (await db
        .selectFrom("deviceAuthorizations")
        .select(["deviceCodeHash", "clientName", "createdAt"])
        .where("userCode", "=", userCode)
        .where("status", "=", "pending")
        .where("expiresAt", ">", new Date().toISOString())
        .executeTakeFirst())
    if (!row) throw new ApiError("NOT_FOUND", "Code not found or expired")
    attempts.refund(key)
    return row
  }

  const decide = async (userId: string, input: string, status: "approved" | "denied") => {
    const { deviceCodeHash } = await findPending(userId, input)
    const result = await db
      .updateTable("deviceAuthorizations")
      .set({ status, userId })
      .where("deviceCodeHash", "=", deviceCodeHash)
      .where("status", "=", "pending")
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) === 0) {
      throw new ApiError("NOT_FOUND", "Code not found or expired")
    }
  }

  return (
    new Hono<AppEnv>()
      .post("/", validate("json", startBody), async (c) => {
        const { clientName } = c.req.valid("json")
        const deviceCode = randomToken()
        const deviceCodeHash = await hashToken(deviceCode)
        const createdAt = now()
        const expiresAt = new Date(Date.parse(createdAt) + EXPIRES_IN_S * 1000).toISOString()
        // Swept here so the table only holds the last few minutes of requests and user codes
        // free up again.
        await db.deleteFrom("deviceAuthorizations").where("expiresAt", "<=", createdAt).execute()
        const { pending } = await db
          .selectFrom("deviceAuthorizations")
          .select((eb) => eb.fn.countAll<number>().as("pending"))
          .executeTakeFirstOrThrow()
        if (Number(pending) >= MAX_PENDING) {
          throw new ApiError(
            "RATE_LIMITED",
            "Too many sign-in requests in progress, try again later",
          )
        }
        for (let attempt = 1; ; attempt++) {
          const userCode = randomUserCode()
          try {
            await db
              .insertInto("deviceAuthorizations")
              .values({
                deviceCodeHash,
                userCode,
                clientName,
                status: "pending",
                userId: null,
                createdAt,
                expiresAt,
                lastPolledAt: null,
              })
              .execute()
            return c.json({
              deviceCode,
              userCode,
              verificationUri,
              verificationUriComplete: `${verificationUri}?code=${userCode}`,
              expiresIn: EXPIRES_IN_S,
              interval: INTERVAL_S,
            })
          } catch (err) {
            if (!isUniqueViolation(err) || attempt >= 5) throw err
          }
        }
      })
      // Always 200 with a status, so the CLI can poll without treating states as errors.
      .post("/token", validate("json", pollBody), async (c) => {
        const deviceCodeHash = await hashToken(c.req.valid("json").deviceCode)
        const row = await db
          .selectFrom("deviceAuthorizations")
          .select(["status", "expiresAt", "lastPolledAt"])
          .where("deviceCodeHash", "=", deviceCodeHash)
          .executeTakeFirst()
        const at = Date.now()
        if (!row || Date.parse(row.expiresAt) <= at) return c.json({ status: "expired" as const })
        if (row.status === "denied") return c.json({ status: "denied" as const })
        if (row.status === "pending") {
          await db
            .updateTable("deviceAuthorizations")
            .set({ lastPolledAt: new Date(at).toISOString() })
            .where("deviceCodeHash", "=", deviceCodeHash)
            .execute()
          const tooSoon =
            row.lastPolledAt !== null && at - Date.parse(row.lastPolledAt) < INTERVAL_S * 1000
          return c.json({ status: tooSoon ? ("slow_down" as const) : ("pending" as const) })
        }

        // Approved. The token is minted by whichever poll consumes the row, so it is handed out
        // exactly once and its plaintext is never stored.
        const issued = await inTransaction(db, async (trx) => {
          const consumed = await trx
            .deleteFrom("deviceAuthorizations")
            .where("deviceCodeHash", "=", deviceCodeHash)
            .where("status", "=", "approved")
            .returning(["userId", "clientName"])
            .executeTakeFirst()
          if (!consumed?.userId) return null
          const user = await trx
            .selectFrom("users")
            .selectAll()
            .where("id", "=", consumed.userId)
            .executeTakeFirstOrThrow()
          const { token, row: apiToken } = await createApiToken(trx, {
            userId: user.id,
            name: consumed.clientName,
            kind: "cli",
            scope: "write",
            expiresAt: cliTokenExpiry(),
          })
          return { token, tokenId: apiToken.id, user: toUserJson(user) }
        })
        if (!issued) return c.json({ status: "expired" as const })
        return c.json({ status: "approved" as const, ...issued })
      })
      .get("/:userCode", requireUser(db), async (c) => {
        const { clientName, createdAt } = await findPending(c.var.user.id, c.req.param("userCode"))
        return c.json({ clientName, createdAt })
      })
      .post("/:userCode/approve", requireUser(db), async (c) => {
        await decide(c.var.user.id, c.req.param("userCode"), "approved")
        return c.body(null, 204)
      })
      .post("/:userCode/deny", requireUser(db), async (c) => {
        await decide(c.var.user.id, c.req.param("userCode"), "denied")
        return c.body(null, 204)
      })
  )
}
