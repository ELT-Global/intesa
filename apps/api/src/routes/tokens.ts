import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { createApiToken, toApiTokenJson } from "../auth/tokens"
import { DAY_MS } from "../db"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"
import { TOKEN_SCOPES } from "../schemas"

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(TOKEN_SCOPES).default("write"),
  // Omitted: the token never expires.
  expiresInDays: z.number().int().min(1).max(3650).optional(),
})

// Mounted ahead of the other /me routes: their guard refuses read-only tokens on DELETE, and
// /current must let any token sign itself out.
export function tokenRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .delete("/current", requireUser(db, { anyScope: true }), async (c) => {
      const session = c.var.session
      if (session.kind !== "token") {
        throw new ApiError("VALIDATION_ERROR", "This request is not authenticated with a token")
      }
      await db.deleteFrom("apiTokens").where("id", "=", session.tokenId).execute()
      return c.body(null, 204)
    })
    .use(requireUser(db))
    .get("/", async (c) => {
      const session = c.var.session
      const rows = await db
        .selectFrom("apiTokens")
        .selectAll()
        .where("userId", "=", c.var.user.id)
        .orderBy("createdAt", "desc")
        .execute()
      return c.json({
        tokens: rows.map((t) => ({
          ...toApiTokenJson(t),
          current: session.kind === "token" && session.tokenId === t.id,
        })),
      })
    })
    .post("/", validate("json", createBody), async (c) => {
      const { name, scope, expiresInDays } = c.req.valid("json")
      const { token, row } = await createApiToken(db, {
        userId: c.var.user.id,
        name,
        kind: "pat",
        scope,
        expiresAt: expiresInDays
          ? new Date(Date.now() + expiresInDays * DAY_MS).toISOString()
          : null,
      })
      // The only time the plaintext is ever shown.
      return c.json({ token, ...toApiTokenJson(row) }, 201)
    })
    .delete("/:tokenId", async (c) => {
      const result = await db
        .deleteFrom("apiTokens")
        .where("id", "=", c.req.param("tokenId"))
        .where("userId", "=", c.var.user.id)
        .executeTakeFirst()
      if (Number(result.numDeletedRows) === 0) throw new ApiError("NOT_FOUND", "Token not found")
      return c.body(null, 204)
    })
}
