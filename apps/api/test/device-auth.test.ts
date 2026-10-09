import { describe, expect, test } from "bun:test"
import { hashToken } from "../src/auth/session"
import { totpCode } from "../src/auth/totp"
import {
  clientWithCookie,
  clientWithToken,
  createTestApp,
  sessionCookieFrom,
  signIn,
  type TestApp,
} from "./helpers"

const CLIENT = "intesa-cli on TEST-PC (win32-x64)"
const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

type Started = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

async function start(t: TestApp, clientName = CLIENT): Promise<Started> {
  const res = await t.app.request("/api/auth/device", post({ clientName }))
  expect(res.status).toBe(200)
  return (await res.json()) as Started
}

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary response shapes
async function poll(t: TestApp, deviceCode: string): Promise<any> {
  const res = await t.app.request("/api/auth/device/token", post({ deviceCode }))
  expect(res.status).toBe(200)
  return res.json()
}

// Lets the next poll through without waiting out the polling interval.
const forgetLastPoll = (t: TestApp) =>
  t.db.updateTable("deviceAuthorizations").set({ lastPolledAt: null }).execute()

// "BCDF-GHJK" typed as "bcdfghjk".
const sloppy = (userCode: string) => userCode.replace("-", "").toLowerCase()

describe("starting a device sign-in", () => {
  test("returns a device code, a user code and where to enter it", async () => {
    const t = await createTestApp()
    const started = await start(t)
    expect(started.userCode).toMatch(USER_CODE)
    expect(started.deviceCode.length).toBeGreaterThanOrEqual(43)
    expect(started.verificationUri).toBe(`${t.config.publicUrl}/device`)
    expect(started.verificationUriComplete).toBe(
      `${t.config.publicUrl}/device?code=${started.userCode}`,
    )
    expect(started.expiresIn).toBe(600)
    expect(started.interval).toBe(5)

    const row = await t.db.selectFrom("deviceAuthorizations").selectAll().executeTakeFirstOrThrow()
    expect(row.deviceCodeHash).toBe(await hashToken(started.deviceCode))
    expect(JSON.stringify(row)).not.toContain(started.deviceCode)
    expect(row).toMatchObject({ userCode: started.userCode, clientName: CLIENT, status: "pending" })
  })

  test("a client name is required and at most 100 characters", async () => {
    const t = await createTestApp()
    for (const clientName of [" ", "x".repeat(101)]) {
      const res = await t.app.request("/api/auth/device", post({ clientName }))
      expect([clientName, res.status]).toEqual([clientName, 400])
    }
  })

  test("new requests are refused while too many are waiting", async () => {
    const t = await createTestApp()
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    for (let batch = 0; batch < 10; batch++) {
      await t.db
        .insertInto("deviceAuthorizations")
        .values(
          Array.from({ length: 100 }, (_, i) => ({
            deviceCodeHash: `hash-${batch}-${i}`,
            userCode: `CODE-${batch}-${i}`,
            clientName: CLIENT,
            status: "pending" as const,
            userId: null,
            createdAt: new Date().toISOString(),
            expiresAt,
            lastPolledAt: null,
          })),
        )
        .execute()
    }
    const res = await t.app.request("/api/auth/device", post({ clientName: CLIENT }))
    expect(res.status).toBe(429)
    expect(((await res.json()) as { code: string }).code).toBe("RATE_LIMITED")

    // Expired requests do not count against the cap.
    await t.db
      .updateTable("deviceAuthorizations")
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where("userCode", "like", "CODE-0-%")
      .execute()
    await start(t)
  })
})

describe("device sign-in flow", () => {
  test("pending, slow_down, approval, then the token exactly once", async () => {
    const t = await createTestApp()
    const { deviceCode, userCode } = await start(t)

    expect(await poll(t, deviceCode)).toEqual({ status: "pending" })
    expect(await poll(t, deviceCode)).toEqual({ status: "slow_down" })
    await forgetLastPoll(t)
    expect(await poll(t, deviceCode)).toEqual({ status: "pending" })

    const me = await signIn(t.app, "device@example.com")
    const shown = await me.call("GET", `/api/auth/device/${sloppy(userCode)}`)
    expect(shown.status).toBe(200)
    expect(shown.body).toEqual({ clientName: CLIENT, createdAt: expect.any(String) })

    expect((await me.call("POST", `/api/auth/device/${userCode}/approve`)).status).toBe(204)

    // Copied out first: Bun's toMatchObject writes the asymmetric matchers into the object.
    const approved = await poll(t, deviceCode)
    const { token, tokenId } = approved
    expect(approved).toMatchObject({
      status: "approved",
      token: expect.stringMatching(/^intesa_cli_[A-Za-z0-9_-]{43}$/),
      tokenId: expect.any(String),
      user: { email: "device@example.com" },
    })
    expect((await poll(t, deviceCode)).status).toBe("expired")

    const cli = clientWithToken(t.app, token)
    expect((await cli.call("GET", "/api/me")).body.user.email).toBe("device@example.com")
    const tokens = (await me.call("GET", "/api/me/tokens")).body.tokens
    expect(tokens).toEqual([
      expect.objectContaining({ id: tokenId, name: CLIENT, kind: "cli", scope: "write" }),
    ])
    expect(Date.parse(tokens[0].expiresAt)).toBeGreaterThan(Date.now() + 89 * 24 * 60 * 60 * 1000)

    // The code is used up.
    expect((await me.call("GET", `/api/auth/device/${userCode}`)).status).toBe(404)
    expect((await me.call("POST", `/api/auth/device/${userCode}/approve`)).status).toBe(404)
  })

  test("a denied request reports denied and yields no token", async () => {
    const t = await createTestApp()
    const { deviceCode, userCode } = await start(t)
    const me = await signIn(t.app, "deny@example.com")

    expect((await me.call("POST", `/api/auth/device/${userCode}/deny`)).status).toBe(204)
    expect(await poll(t, deviceCode)).toEqual({ status: "denied" })
    expect((await me.call("POST", `/api/auth/device/${userCode}/approve`)).status).toBe(404)
    expect(await poll(t, deviceCode)).toEqual({ status: "denied" })
    expect((await me.call("GET", "/api/me/tokens")).body.tokens).toEqual([])
  })

  test("an expired request can be neither shown nor approved, and polls as expired", async () => {
    const t = await createTestApp()
    const { deviceCode, userCode } = await start(t)
    await t.db
      .updateTable("deviceAuthorizations")
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .execute()
    const me = await signIn(t.app, "late@example.com")

    const shown = await me.call("GET", `/api/auth/device/${userCode}`)
    expect(shown.status).toBe(404)
    expect(shown.body.code).toBe("NOT_FOUND")
    expect((await me.call("POST", `/api/auth/device/${userCode}/approve`)).status).toBe(404)
    expect(await poll(t, deviceCode)).toEqual({ status: "expired" })
  })

  test("an approval that is not picked up before expiry is lost", async () => {
    const t = await createTestApp()
    const { deviceCode, userCode } = await start(t)
    const me = await signIn(t.app, "slow-cli@example.com")
    await me.call("POST", `/api/auth/device/${userCode}/approve`)
    await t.db
      .updateTable("deviceAuthorizations")
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .execute()
    expect(await poll(t, deviceCode)).toEqual({ status: "expired" })
    expect((await me.call("GET", "/api/me/tokens")).body.tokens).toEqual([])
  })

  test("simultaneous polls after approval hand out exactly one token", async () => {
    const t = await createTestApp()
    const { deviceCode, userCode } = await start(t)
    const me = await signIn(t.app, "race@example.com")
    await me.call("POST", `/api/auth/device/${userCode}/approve`)

    const polls = await Promise.all(Array.from({ length: 5 }, () => poll(t, deviceCode)))
    expect(polls.map((p) => p.status).sort()).toEqual([
      "approved",
      "expired",
      "expired",
      "expired",
      "expired",
    ])
    expect(await t.db.selectFrom("apiTokens").selectAll().execute()).toHaveLength(1)
  })

  test("an unknown device code polls as expired", async () => {
    const t = await createTestApp()
    expect(await poll(t, "not-a-real-device-code")).toEqual({ status: "expired" })
  })
})

describe("who may approve", () => {
  test("anonymous callers get 401", async () => {
    const t = await createTestApp()
    const { userCode } = await start(t)
    const anon = clientWithCookie(t.app, "")
    expect((await anon.call("GET", `/api/auth/device/${userCode}`)).status).toBe(401)
    expect((await anon.call("POST", `/api/auth/device/${userCode}/approve`)).status).toBe(401)
  })

  test("a session still waiting for its 2FA code cannot look up or approve", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "pending@example.com")
    const { body } = await me.call("POST", "/api/me/2fa/setup")
    await me.call("POST", "/api/me/2fa/enable", { code: await totpCode(body.secret) })
    const login = await t.app.request("/api/auth/dev-login", post({ email: "pending@example.com" }))
    const pending = clientWithCookie(t.app, sessionCookieFrom(login))

    const { deviceCode, userCode } = await start(t)
    for (const [method, path] of [
      ["GET", `/api/auth/device/${userCode}`],
      ["POST", `/api/auth/device/${userCode}/approve`],
    ] as const) {
      const res = await pending.call(method, path)
      expect([path, res.status]).toEqual([path, 401])
      expect(res.body.code).toBe("TWO_FACTOR_REQUIRED")
    }
    expect(await poll(t, deviceCode)).toEqual({ status: "pending" })
  })

  test("a read-only token cannot approve", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "readonly@example.com")
    const { token } = (await me.call("POST", "/api/me/tokens", { name: "r", scope: "read" })).body
    const { deviceCode, userCode } = await start(t)
    const res = await clientWithToken(t.app, token).call(
      "POST",
      `/api/auth/device/${userCode}/approve`,
    )
    expect(res.status).toBe(403)
    expect(await poll(t, deviceCode)).toEqual({ status: "pending" })
  })
})

describe("user code guessing", () => {
  test("wrong codes use up a budget that then locks out even the right code", async () => {
    const t = await createTestApp()
    const { userCode } = await start(t)
    const me = await signIn(t.app, "guess@example.com")
    const wrong = userCode === "BBBB-BBBB" ? "CCCC-CCCC" : "BBBB-BBBB"

    for (let i = 0; i < 5; i++) {
      expect((await me.call("GET", `/api/auth/device/${wrong}`)).status).toBe(404)
    }
    const locked = await me.call("GET", `/api/auth/device/${userCode}`)
    expect(locked.status).toBe(429)
    expect(locked.body.code).toBe("RATE_LIMITED")
    expect((await me.call("POST", `/api/auth/device/${userCode}/approve`)).status).toBe(429)
  })

  test("a lookup that finds a code neither resets the misses nor counts as one", async () => {
    const t = await createTestApp()
    const { userCode } = await start(t)
    const me = await signIn(t.app, "typo@example.com")

    // Malformed codes count as misses too.
    for (let i = 0; i < 4; i++) {
      expect((await me.call("GET", "/api/auth/device/AEIO-U123")).status).toBe(404)
    }
    // Someone holding a valid code of their own cannot use it to clear their misses.
    for (let i = 0; i < 3; i++) {
      expect((await me.call("GET", `/api/auth/device/${userCode}`)).status).toBe(200)
    }
    expect((await me.call("GET", "/api/auth/device/AEIO-U123")).status).toBe(404)
    expect((await me.call("GET", `/api/auth/device/${userCode}`)).status).toBe(429)
  })

  test("misses here do not use up the two-factor code budget", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "budgets@example.com")
    const { body } = await me.call("POST", "/api/me/2fa/setup")
    await me.call("POST", "/api/me/2fa/enable", { code: await totpCode(body.secret) })

    for (let i = 0; i < 5; i++) await me.call("GET", "/api/auth/device/BBBB-BBBB")
    expect((await me.call("GET", "/api/auth/device/BBBB-BBBB")).status).toBe(429)

    const off = await me.call("POST", "/api/me/2fa/disable", { code: await totpCode(body.secret) })
    expect(off.status).toBe(200)
  })
})

describe("cross-site requests", () => {
  test("a cross-site form post cannot approve with the browser session", async () => {
    const t = await createTestApp()
    const { deviceCode, userCode } = await start(t)
    const me = await signIn(t.app, "csrf@example.com")

    const forged = await t.app.request(`/api/auth/device/${userCode}/approve`, {
      method: "POST",
      headers: {
        cookie: me.cookie,
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "x=1",
    })
    expect(forged.status).toBe(403)
    expect(((await forged.json()) as { code: string }).code).toBe("FORBIDDEN")
    expect(await poll(t, deviceCode)).toEqual({ status: "pending" })

    // Same-origin JSON goes through.
    const ok = await t.app.request(`/api/auth/device/${userCode}/approve`, {
      method: "POST",
      headers: {
        cookie: me.cookie,
        origin: t.config.publicUrl,
        "content-type": "application/json",
      },
      body: "{}",
    })
    expect(ok.status).toBe(204)
  })

  test("a body-less post, as the web app sends, is judged by its origin", async () => {
    const t = await createTestApp()
    const { userCode } = await start(t)
    const me = await signIn(t.app, "csrf-origin@example.com")
    const deny = (origin: string) =>
      t.app.request(`/api/auth/device/${userCode}/deny`, {
        method: "POST",
        headers: { cookie: me.cookie, origin },
      })
    expect((await deny("https://evil.example")).status).toBe(403)
    expect((await deny(t.config.publicUrl)).status).toBe(204)
  })
})
