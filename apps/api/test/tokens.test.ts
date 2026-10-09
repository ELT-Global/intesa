import { describe, expect, test } from "bun:test"
import { hashToken } from "../src/auth/session"
import { totpCode } from "../src/auth/totp"
import {
  type Client,
  clientWithCookie,
  clientWithToken,
  createTestApp,
  sessionCookieFrom,
  setupProject,
  signIn,
  type TestApp,
} from "./helpers"

const DAY_MS = 24 * 60 * 60 * 1000

async function createToken(client: Client, body: Record<string, unknown> = { name: "laptop" }) {
  const res = await client.call("POST", "/api/me/tokens", body)
  expect(res.status).toBe(201)
  return res.body as { token: string; id: string; [key: string]: unknown }
}

async function tokenRow(t: TestApp, id: string) {
  return t.db.selectFrom("apiTokens").selectAll().where("id", "=", id).executeTakeFirstOrThrow()
}

describe("creating and listing tokens", () => {
  test("the plaintext token is returned once; only its hash is stored", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "create@example.com")
    const created = await createToken(me, { name: "  CI runner  " })

    expect(created.token).toMatch(/^intesa_pat_[A-Za-z0-9_-]{43}$/)
    expect(created).toMatchObject({
      name: "CI runner",
      kind: "pat",
      scope: "write",
      lastFour: created.token.slice(-4),
      lastUsedAt: null,
      expiresAt: null,
    })

    const row = await tokenRow(t, created.id)
    expect(row.tokenHash).toBe(await hashToken(created.token))
    expect(JSON.stringify(row)).not.toContain(created.token)

    const list = await me.call("GET", "/api/me/tokens")
    expect(list.status).toBe(200)
    expect(list.body.tokens).toEqual([
      {
        id: created.id,
        name: "CI runner",
        kind: "pat",
        scope: "write",
        lastFour: created.token.slice(-4),
        createdAt: created.createdAt,
        lastUsedAt: null,
        expiresAt: null,
        current: false,
      },
    ])
    const raw = JSON.stringify(list.body)
    expect(raw).not.toContain(created.token)
    expect(raw).not.toContain(row.tokenHash)
  })

  test("an expiry in days and a read scope can be chosen", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "expiry@example.com")
    const created = await createToken(me, { name: "agent", scope: "read", expiresInDays: 7 })
    expect(created.scope).toBe("read")
    const expiresAt = Date.parse(created.expiresAt as string)
    expect(expiresAt).toBeGreaterThan(Date.now() + 7 * DAY_MS - 60_000)
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS)
  })

  test("invalid bodies are rejected", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "invalid@example.com")
    for (const body of [
      { name: "" },
      { name: "x", scope: "admin" },
      { name: "x", expiresInDays: 0 },
      { name: "x", expiresInDays: 1.5 },
    ]) {
      const res = await me.call("POST", "/api/me/tokens", body)
      expect([body, res.status]).toEqual([body, 400])
      expect(res.body.code).toBe("VALIDATION_ERROR")
    }
    expect((await me.call("GET", "/api/me/tokens")).body.tokens).toEqual([])
  })

  test("token routes need a signed-in user", async () => {
    const t = await createTestApp()
    const anon = clientWithCookie(t.app, "")
    expect((await anon.call("GET", "/api/me/tokens")).status).toBe(401)
    expect((await anon.call("POST", "/api/me/tokens", { name: "x" })).status).toBe(401)
  })
})

describe("bearer authentication", () => {
  test("a token works on normal endpoints without a cookie, including writes", async () => {
    const t = await createTestApp()
    const { owner, project } = await setupProject(t, "bearer@example.com")
    const { token } = await createToken(owner)
    const cli = clientWithToken(t.app, token)

    const me = await cli.call("GET", "/api/me")
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe("bearer@example.com")
    const created = await cli.call("POST", `/api/projects/${project.id}/tasks`, {
      title: "From CLI",
    })
    expect(created.status).toBe(201)
  })

  test("the bearer header wins over the session cookie", async () => {
    const t = await createTestApp()
    const alice = await signIn(t.app, "alice@example.com")
    const bob = await signIn(t.app, "bob@example.com")
    const { token } = await createToken(bob)

    const both = clientWithToken(t.app, token, alice.cookie)
    expect((await both.call("GET", "/api/me")).body.user.email).toBe("bob@example.com")
  })

  test("a bad bearer token is refused even when a valid cookie is sent too", async () => {
    const t = await createTestApp()
    const alice = await signIn(t.app, "nofallback@example.com")
    for (const token of ["intesa_pat_unknown", ""]) {
      const res = await clientWithToken(t.app, token, alice.cookie).call("GET", "/api/me")
      expect([token, res.status]).toEqual([token, 401])
      expect(res.body.code).toBe("UNAUTHORIZED")
    }
  })

  test("a non-bearer Authorization header (e.g. a proxy's Basic auth) leaves the cookie in charge", async () => {
    const t = await createTestApp()
    const alice = await signIn(t.app, "basic@example.com")
    const res = await t.app.request("/api/me", {
      headers: { cookie: alice.cookie, authorization: `Basic ${btoa("proxy:secret")}` },
    })
    expect(res.status).toBe(200)
  })

  test("revoked and expired tokens are refused", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "revoke@example.com")
    const revoked = await createToken(me, { name: "a" })
    const expired = await createToken(me, { name: "b", expiresInDays: 30 })

    expect((await me.call("DELETE", `/api/me/tokens/${revoked.id}`)).status).toBe(204)
    const afterRevoke = await clientWithToken(t.app, revoked.token).call("GET", "/api/me")
    expect(afterRevoke.status).toBe(401)
    expect(afterRevoke.body.code).toBe("UNAUTHORIZED")

    await t.db
      .updateTable("apiTokens")
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where("id", "=", expired.id)
      .execute()
    expect((await clientWithToken(t.app, expired.token).call("GET", "/api/me")).status).toBe(401)
  })

  test("bearer requests are never pending two-factor, even for a user with 2FA", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "twofa@example.com")
    const { body } = await me.call("POST", "/api/me/2fa/setup")
    await me.call("POST", "/api/me/2fa/enable", { code: await totpCode(body.secret) })
    const { token } = await createToken(me)
    const cli = clientWithToken(t.app, token)

    expect((await cli.call("GET", "/api/me")).status).toBe(200)
    // The verify step is only for browser sign-ins that are waiting for a code.
    const verify = await cli.call("POST", "/api/auth/2fa", { code: "123456" })
    expect(verify.status).toBe(400)
    expect(verify.body.code).toBe("VALIDATION_ERROR")
  })
})

describe("read-scope tokens", () => {
  test("can read but get FORBIDDEN on any write", async () => {
    const t = await createTestApp()
    const { owner, project } = await setupProject(t, "reader@example.com")
    const task = (await owner.call("POST", `/api/projects/${project.id}/tasks`, { title: "Keep" }))
      .body.task
    const { token } = await createToken(owner, { name: "agent", scope: "read" })
    const reader = clientWithToken(t.app, token)

    expect((await reader.call("GET", `/api/tasks/${task.id}`)).status).toBe(200)
    expect((await reader.call("GET", "/api/me/tokens")).status).toBe(200)

    const writes: [string, string, unknown?][] = [
      ["PATCH", `/api/tasks/${task.id}`, { title: "Changed" }],
      ["DELETE", `/api/tasks/${task.id}`],
      ["POST", `/api/projects/${project.id}/tasks`, { title: "New" }],
      ["POST", "/api/me/tokens", { name: "escalate" }],
      ["PATCH", "/api/me", { name: "Renamed" }],
    ]
    for (const [method, path, body] of writes) {
      const res = await reader.call(method, path, body)
      expect([method, path, res.status]).toEqual([method, path, 403])
      expect(res.body.code).toBe("FORBIDDEN")
    }
    expect((await owner.call("GET", `/api/tasks/${task.id}`)).body.task.title).toBe("Keep")
    expect((await owner.call("GET", "/api/me/tokens")).body.tokens).toHaveLength(1)
  })
})

describe("usage tracking and expiry", () => {
  test("last use is recorded at most once a day", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "lastused@example.com")
    const { token, id } = await createToken(me)
    const cli = clientWithToken(t.app, token)

    await cli.call("GET", "/api/me")
    const first = (await tokenRow(t, id)).lastUsedAt
    expect(first).not.toBeNull()

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await t.db.updateTable("apiTokens").set({ lastUsedAt: hourAgo }).where("id", "=", id).execute()
    await cli.call("GET", "/api/me")
    expect((await tokenRow(t, id)).lastUsedAt).toBe(hourAgo)

    const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS).toISOString()
    await t.db
      .updateTable("apiTokens")
      .set({ lastUsedAt: twoDaysAgo })
      .where("id", "=", id)
      .execute()
    await cli.call("GET", "/api/me")
    expect(Date.parse((await tokenRow(t, id)).lastUsedAt ?? "")).toBeGreaterThan(
      Date.now() - 60_000,
    )
  })

  test("CLI tokens slide their 90-day expiry when used; personal tokens keep theirs", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "slide@example.com")
    const cliToken = await createToken(me, { name: "cli" })
    const pat = await createToken(me, { name: "pat", expiresInDays: 30 })
    const soon = new Date(Date.now() + 3 * DAY_MS).toISOString()
    const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS).toISOString()
    await t.db
      .updateTable("apiTokens")
      .set({ kind: "cli", expiresAt: soon, lastUsedAt: twoDaysAgo })
      .where("id", "=", cliToken.id)
      .execute()
    await t.db
      .updateTable("apiTokens")
      .set({ expiresAt: soon, lastUsedAt: twoDaysAgo })
      .where("id", "=", pat.id)
      .execute()

    expect((await clientWithToken(t.app, cliToken.token).call("GET", "/api/me")).status).toBe(200)
    expect((await clientWithToken(t.app, pat.token).call("GET", "/api/me")).status).toBe(200)

    const slid = Date.parse((await tokenRow(t, cliToken.id)).expiresAt ?? "")
    expect(slid).toBeGreaterThan(Date.now() + 89 * DAY_MS)
    expect((await tokenRow(t, pat.id)).expiresAt).toBe(soon)
  })
})

describe("revoking tokens", () => {
  test("users only see and revoke their own tokens", async () => {
    const t = await createTestApp()
    const alice = await signIn(t.app, "own-a@example.com")
    const bob = await signIn(t.app, "own-b@example.com")
    const alices = await createToken(alice)
    await createToken(bob, { name: "bob's" })

    const bobList = await bob.call("GET", "/api/me/tokens")
    expect(bobList.body.tokens.map((x: { name: string }) => x.name)).toEqual(["bob's"])

    const res = await bob.call("DELETE", `/api/me/tokens/${alices.id}`)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe("NOT_FOUND")
    expect((await clientWithToken(t.app, alices.token).call("GET", "/api/me")).status).toBe(200)
    expect((await bob.call("DELETE", "/api/me/tokens/nope")).status).toBe(404)
  })

  test("DELETE /me/tokens/current revokes the calling token, even a read-only one", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "current@example.com")
    const reader = await createToken(me, { name: "reader", scope: "read" })
    const other = await createToken(me, { name: "other" })
    const cli = clientWithToken(t.app, reader.token)

    const list = await cli.call("GET", "/api/me/tokens")
    const flags = Object.fromEntries(
      list.body.tokens.map((x: { name: string; current: boolean }) => [x.name, x.current]),
    )
    expect(flags).toEqual({ reader: true, other: false })

    expect((await cli.call("DELETE", "/api/me/tokens/current")).status).toBe(204)
    expect((await cli.call("GET", "/api/me")).status).toBe(401)
    expect((await clientWithToken(t.app, other.token).call("GET", "/api/me")).status).toBe(200)
    const remaining = (await me.call("GET", "/api/me/tokens")).body.tokens
    expect(remaining.map((x: { name: string }) => x.name)).toEqual(["other"])
  })

  test("DELETE /me/tokens/current with a cookie session is a validation error", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "cookie-current@example.com")
    await createToken(me)
    const res = await me.call("DELETE", "/api/me/tokens/current")
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
    expect((await me.call("GET", "/api/me/tokens")).body.tokens).toHaveLength(1)
    expect((await me.call("GET", "/api/me")).status).toBe(200)
  })

  test("logout with a bearer token revokes that token and leaves the browser session alone", async () => {
    const t = await createTestApp()
    const login = await t.app.request("/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "logout@example.com" }),
    })
    const browser = clientWithCookie(t.app, sessionCookieFrom(login))
    const { token } = await createToken(browser)

    const out = await clientWithToken(t.app, token, browser.cookie).call("POST", "/api/auth/logout")
    expect(out.status).toBe(204)
    expect(out.res.headers.getSetCookie()).toEqual([])
    expect((await clientWithToken(t.app, token).call("GET", "/api/me")).status).toBe(401)
    expect((await browser.call("GET", "/api/me")).status).toBe(200)
  })
})
