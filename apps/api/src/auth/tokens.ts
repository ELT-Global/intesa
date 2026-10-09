import type { Context } from "hono"
import type { Selectable } from "kysely"
import { DAY_MS, type Db, newId, now } from "../db"
import type { ApiTokenTable } from "../db/schema"
import type { TokenKind, TokenScope } from "../schemas"
import { hashToken, randomToken, type TokenSession, type User } from "./session"

// CLI sign-ins slide like browser sessions, so a CLI in regular use never has to sign in again.
const CLI_TOKEN_DAYS = 90

export type ApiTokenJson = {
  id: string
  name: string
  kind: TokenKind
  scope: TokenScope
  lastFour: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}

export const toApiTokenJson = (t: Selectable<ApiTokenTable>): ApiTokenJson => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  scope: t.scope,
  lastFour: t.lastFour,
  createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt,
  expiresAt: t.expiresAt,
})

export const cliTokenExpiry = (from = Date.now()) =>
  new Date(from + CLI_TOKEN_DAYS * DAY_MS).toISOString()

// The token sent as `Authorization: Bearer <token>`, or undefined when there is none. Other
// schemes do not count: a proxy's Basic auth in front of the app must not hide the cookie.
// A Bearer header with a missing value is returned as "" so it fails instead of falling back.
export function bearerToken(c: Context): string | undefined {
  const header = c.req.header("authorization")
  if (!header || !/^bearer(\s|$)/i.test(header)) return undefined
  return header.slice("bearer".length).trim()
}

// The prefix makes leaked tokens easy to grep for and to match in secret scanners.
export async function createApiToken(
  db: Db,
  input: {
    userId: string
    name: string
    kind: TokenKind
    scope: TokenScope
    expiresAt: string | null
  },
) {
  const token = `intesa_${input.kind}_${randomToken()}`
  const row = await db
    .insertInto("apiTokens")
    .values({
      id: newId(),
      ...input,
      tokenHash: await hashToken(token),
      lastFour: token.slice(-4),
      createdAt: now(),
      lastUsedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  return { token, row }
}

// Resolves a bearer token. Last use is recorded at most once a day, which is also when a CLI
// token's expiry slides forward; personal tokens keep the expiry they were created with.
// Expired tokens stay listed (as expired) until the user revokes them.
export async function loadTokenSession(
  db: Db,
  token: string,
): Promise<{ user: User; session: TokenSession } | null> {
  if (!token) return null
  const row = await db
    .selectFrom("apiTokens")
    .innerJoin("users", "users.id", "apiTokens.userId")
    .selectAll("users")
    .select([
      "apiTokens.id as tokenId",
      "apiTokens.kind as tokenKind",
      "apiTokens.scope as tokenScope",
      "apiTokens.expiresAt as tokenExpiresAt",
      "apiTokens.lastUsedAt as tokenLastUsedAt",
    ])
    .where("apiTokens.tokenHash", "=", await hashToken(token))
    .executeTakeFirst()
  if (!row) return null

  const { tokenId, tokenKind, tokenScope, tokenExpiresAt, tokenLastUsedAt, ...user } = row
  const at = Date.now()
  if (tokenExpiresAt !== null && Date.parse(tokenExpiresAt) <= at) return null
  if (tokenLastUsedAt === null || Date.parse(tokenLastUsedAt) <= at - DAY_MS) {
    await db
      .updateTable("apiTokens")
      .set({
        lastUsedAt: new Date(at).toISOString(),
        ...(tokenKind === "cli" && { expiresAt: cliTokenExpiry(at) }),
      })
      .where("id", "=", tokenId)
      .execute()
  }
  return { user, session: { kind: "token", tokenId, scope: tokenScope, pendingTwoFactor: false } }
}

export async function revokeTokenByValue(db: Db, token: string) {
  await db
    .deleteFrom("apiTokens")
    .where("tokenHash", "=", await hashToken(token))
    .execute()
}
