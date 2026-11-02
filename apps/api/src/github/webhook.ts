import { createHmac, timingSafeEqual } from "node:crypto"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { Db } from "../db"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { type Hook, onPullRequest } from "./pull-requests"

// What Intesa does with each GitHub event, by the X-GitHub-Event header. The reply is shown in
// GitHub's list of recent deliveries. A new use of the webhook is a new entry here.
const handlers: Record<string, (db: Db, hook: Hook, payload: unknown) => Promise<object>> = {
  // Sent once when the webhook is created, to check it is reachable.
  ping: async () => ({ ok: true }),
  pull_request: onPullRequest,
}

// GitHub caps its payloads at 25 MB; anything bigger is not from GitHub.
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024

// GitHub signs the raw body with the shared secret: "sha256=<hex HMAC-SHA256>".
export function validSignature(secret: string, body: Uint8Array, header: string | undefined) {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
  const given = Buffer.from(header ?? "")
  return given.length === expected.length && timingSafeEqual(given, Buffer.from(expected))
}

// Each workspace's webhook has its own URL and secret; the URL says which workspace an event is
// for. It never uses a session, and nothing is read or changed until the signature checks out;
// the body is not even read for a URL that is no webhook.
export function webhookRoutes({ db }: Deps) {
  const refused = () => new ApiError("UNAUTHORIZED", "Missing or invalid webhook signature")
  return new Hono().post(
    "/github/:hookId",
    bodyLimit({
      maxSize: MAX_PAYLOAD_BYTES,
      onError: () => {
        throw new ApiError("VALIDATION_ERROR", "Webhook payloads must be 25 MB or smaller")
      },
    }),
    async (c) => {
      const hook = await db
        .selectFrom("githubWebhooks")
        .select(["workspaceId", "secret", "mergeBranch", "token"])
        .where("hookId", "=", c.req.param("hookId"))
        .executeTakeFirst()
      if (!hook) throw refused()
      const body = new Uint8Array(await c.req.arrayBuffer())
      if (!validSignature(hook.secret, body, c.req.header("x-hub-signature-256"))) throw refused()
      const event = c.req.header("x-github-event") ?? ""
      // Own entries only: "constructor" and the like are not handlers.
      const handler = Object.hasOwn(handlers, event) ? handlers[event] : undefined
      if (!handler) return c.body(null, 204)
      let payload: unknown
      try {
        payload = JSON.parse(new TextDecoder().decode(body))
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Send webhook payloads as application/json")
      }
      return c.json(await handler(db, hook, payload))
    },
  )
}
