import { describe, expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import { Hono } from "hono"
import { type AppEnv, requirePending2fa, requireUser } from "../src/auth/middleware"
import { totpCode } from "../src/auth/totp"
import { compressJson } from "../src/lib/compress-json"
import { onError } from "../src/lib/errors"
import { createTestApp, sessionCookieFrom, signIn } from "./helpers"

describe("guard short-circuit", () => {
  test("a session accepted as pending 2FA never satisfies requireUser later in the chain", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "chain@example.com")
    const { body } = await me.call("POST", "/api/me/2fa/setup")
    await me.call("POST", "/api/me/2fa/enable", { code: await totpCode(body.secret) })
    const login = await t.app.request("/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "chain@example.com" }),
    })
    const pending = sessionCookieFrom(login)

    // Both guards on one path, the pending-only guard first.
    const app = new Hono<AppEnv>()
      .use(requirePending2fa(t.db))
      .use(requireUser(t.db))
      .get("/guarded", (c) => c.json({ user: c.var.user.email }))
    app.onError(onError)

    const res = await app.request("/guarded", { headers: { cookie: pending } })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe("TWO_FACTOR_REQUIRED")
  })

  test("a full session passes requireUser repeatedly but is refused by the pending-only guard", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "full@example.com")

    const twice = new Hono<AppEnv>()
      .use(requireUser(t.db))
      .use(requireUser(t.db))
      .get("/ok", (c) => c.json({ user: c.var.user.email }))
    twice.onError(onError)
    expect((await twice.request("/ok", { headers: { cookie: me.cookie } })).status).toBe(200)

    const reversed = new Hono<AppEnv>()
      .use(requireUser(t.db))
      .use(requirePending2fa(t.db))
      .get("/nope", (c) => c.json({}))
    reversed.onError(onError)
    expect((await reversed.request("/nope", { headers: { cookie: me.cookie } })).status).toBe(400)
  })
})

describe("JSON compression headers", () => {
  const big = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item ${i}` })) }

  function appWith(headers: Record<string, string>) {
    return new Hono().use(compressJson).get("/x", (c) => c.json(big, 200, headers))
  }

  test("drops the stale Content-Length when it compresses", async () => {
    const res = await appWith({ "Content-Length": "123" }).request("/x", {
      headers: { "accept-encoding": "gzip" },
    })
    expect(res.headers.get("content-encoding")).toBe("gzip")
    expect(res.headers.get("content-length")).not.toBe("123")
    expect(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString())).toEqual(big)
  })

  test("drops it when it leaves the body alone too", async () => {
    const res = await appWith({ "Content-Length": "123" }).request("/x")
    expect(res.headers.get("content-encoding")).toBeNull()
    expect(res.headers.get("content-length")).not.toBe("123")
    expect(await res.json()).toEqual(big)
  })

  test("does not repeat Accept-Encoding in Vary", async () => {
    const res = await appWith({ Vary: "Origin, Accept-Encoding" }).request("/x", {
      headers: { "accept-encoding": "gzip" },
    })
    const vary = res.headers.get("vary") ?? ""
    expect(vary.match(/accept-encoding/gi)).toHaveLength(1)
    expect(vary).toContain("Origin")

    const plain = await appWith({}).request("/x")
    expect(plain.headers.get("vary")).toBe("Accept-Encoding")
  })
})
