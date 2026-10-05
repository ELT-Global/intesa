import { describe, expect, test } from "bun:test"
import { totpCode } from "../src/auth/totp"
import { clientWithCookie, createTestApp, sessionCookieFrom, signIn } from "./helpers"

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

describe("dev login gate", () => {
  test("is a 404 in production even when DEV_LOGIN is requested", async () => {
    // configFromEnv derives devLogin=false in production; mirror that here.
    const { configFromEnv } = await import("../src/config")
    const config = configFromEnv({ NODE_ENV: "production", DEV_LOGIN: "true" })
    expect(config.devLogin).toBe(false)

    const { app } = await createTestApp({ devLogin: config.devLogin })
    const res = await app.request("/api/auth/dev-login", json({ email: "a@example.com" }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" })
  })

  test("is a 404 when DEV_LOGIN is unset", async () => {
    const { configFromEnv } = await import("../src/config")
    expect(configFromEnv({ NODE_ENV: "development" }).devLogin).toBe(false)
    expect(configFromEnv({ NODE_ENV: "development", DEV_LOGIN: "true" }).devLogin).toBe(true)
  })

  test("auth config reports what is enabled", async () => {
    const { app } = await createTestApp({ devLogin: false })
    const res = await app.request("/api/auth/config")
    expect(await res.json()).toEqual({ google: false, devLogin: false })

    const withGoogle = await createTestApp({ googleClientId: "id", googleClientSecret: "secret" })
    const res2 = await withGoogle.app.request("/api/auth/config")
    expect(await res2.json()).toEqual({ google: true, devLogin: true })
  })

  test("creates the user and a session; name defaults to the email local part", async () => {
    const { app } = await createTestApp()
    const res = await app.request("/api/auth/dev-login", json({ email: "Ada@Example.com" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      user: { email: "ada@example.com", name: "ada", avatarUrl: null, totpEnabled: false },
    })
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("intesa_session="))
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")

    const me = await clientWithCookie(app, sessionCookieFrom(res)).call("GET", "/api/me")
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe("ada@example.com")
  })

  test("rejects an invalid email", async () => {
    const { app } = await createTestApp()
    const res = await app.request("/api/auth/dev-login", json({ email: "nope" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" })
  })
})

describe("sessions", () => {
  test("/api/me is 401 without a cookie or with an unknown token", async () => {
    const { app } = await createTestApp()
    const res = await app.request("/api/me")
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" })

    const bogus = await clientWithCookie(app, "intesa_session=bogus").call("GET", "/api/me")
    expect(bogus.status).toBe(401)
  })

  test("stores only a hash of the token", async () => {
    const { app, db } = await createTestApp()
    const me = await signIn(app, "hash@example.com")
    const token = me.cookie.split("=")[1] ?? ""
    const rows = await db.selectFrom("sessions").selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tokenHash).not.toBe(token)
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test("expired sessions are rejected", async () => {
    const { app, db } = await createTestApp()
    const me = await signIn(app, "old@example.com")
    await db.updateTable("sessions").set({ expiresAt: "2000-01-01T00:00:00.000Z" }).execute()
    expect((await me.call("GET", "/api/me")).status).toBe(401)
  })

  test("sliding expiry extends a session that is close to expiring", async () => {
    const { app, db } = await createTestApp()
    const me = await signIn(app, "slide@example.com")
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    await db.updateTable("sessions").set({ expiresAt: soon }).execute()
    expect((await me.call("GET", "/api/me")).status).toBe(200)
    const row = await db.selectFrom("sessions").select("expiresAt").executeTakeFirstOrThrow()
    expect(Date.parse(row.expiresAt)).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000)
  })

  test("logout invalidates the session", async () => {
    const { app } = await createTestApp()
    const me = await signIn(app, "bye@example.com")
    const out = await me.call("POST", "/api/auth/logout")
    expect(out.status).toBe(204)
    expect(out.res.headers.getSetCookie().join(";")).toContain("intesa_session=;")
    // The old cookie must no longer work even if a client keeps sending it.
    expect((await me.call("GET", "/api/me")).status).toBe(401)
  })

  test("PATCH /api/me renames the user and validates the name", async () => {
    const { app } = await createTestApp()
    const me = await signIn(app, "rename@example.com")
    const ok = await me.call("PATCH", "/api/me", { name: "  New Name " })
    expect(ok.body.user.name).toBe("New Name")
    expect((await me.call("PATCH", "/api/me", { name: "   " })).status).toBe(400)
  })
})

describe("two-factor authentication", () => {
  async function enable2fa(app: Awaited<ReturnType<typeof createTestApp>>["app"], email: string) {
    const me = await signIn(app, email)
    const setup = await me.call("POST", "/api/me/2fa/setup")
    expect(setup.status).toBe(200)
    const { secret, otpauthUrl } = setup.body as { secret: string; otpauthUrl: string }
    const enabled = await me.call("POST", "/api/me/2fa/enable", { code: await totpCode(secret) })
    expect(enabled.status).toBe(200)
    expect(enabled.body.user.totpEnabled).toBe(true)
    return { me, secret, otpauthUrl }
  }

  test("setup returns a base32 secret and an otpauth URL, and does not enable 2FA", async () => {
    const { app } = await createTestApp()
    const me = await signIn(app, "setup@example.com")
    const { body } = await me.call("POST", "/api/me/2fa/setup")
    expect(body.secret).toMatch(/^[A-Z2-7]+$/)
    expect(body.otpauthUrl).toStartWith("otpauth://totp/Intesa")
    expect(body.otpauthUrl).toContain(`secret=${body.secret}`)
    expect((await me.call("GET", "/api/me")).body.user.totpEnabled).toBe(false)
  })

  test("enable rejects a wrong code and a missing setup", async () => {
    const { app } = await createTestApp()
    const me = await signIn(app, "wrong@example.com")
    const early = await me.call("POST", "/api/me/2fa/enable", { code: "123456" })
    expect(early.status).toBe(400)

    const { body } = await me.call("POST", "/api/me/2fa/setup")
    const good = await totpCode(body.secret)
    const bad = good === "000000" ? "000001" : "000000"
    const res = await me.call("POST", "/api/me/2fa/enable", { code: bad })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
    expect((await me.call("GET", "/api/me")).body.user.totpEnabled).toBe(false)
  })

  test("setup is a conflict once 2FA is enabled", async () => {
    const { app } = await createTestApp()
    const { me } = await enable2fa(app, "twice@example.com")
    const res = await me.call("POST", "/api/me/2fa/setup")
    expect(res.status).toBe(409)
    expect(res.body.code).toBe("CONFLICT")
  })

  test("sign-in with 2FA yields a pending session until the code is verified", async () => {
    const { app } = await createTestApp()
    const { secret } = await enable2fa(app, "pending@example.com")

    const login = await app.request("/api/auth/dev-login", json({ email: "pending@example.com" }))
    expect(login.status).toBe(200)
    expect(await login.json()).toEqual({ twoFactorRequired: true })
    const pending = clientWithCookie(app, sessionCookieFrom(login))

    const me = await pending.call("GET", "/api/me")
    expect(me.status).toBe(401)
    expect(me.body.code).toBe("TWO_FACTOR_REQUIRED")
    // A pending session must not reach anything else either.
    expect((await pending.call("GET", "/api/workspaces")).body.code).toBe("TWO_FACTOR_REQUIRED")

    const good = await totpCode(secret)
    const wrong = await pending.call("POST", "/api/auth/2fa", {
      code: good === "000000" ? "000001" : "000000",
    })
    expect(wrong.status).toBe(400)
    expect(wrong.body.code).toBe("VALIDATION_ERROR")
    expect((await pending.call("GET", "/api/me")).status).toBe(401)

    const verified = await pending.call("POST", "/api/auth/2fa", { code: good })
    expect(verified.status).toBe(200)
    expect(verified.body.user.email).toBe("pending@example.com")
    expect((await pending.call("GET", "/api/me")).status).toBe(200)
  })

  test("the 2FA verify endpoint is unusable without a pending session", async () => {
    const { app } = await createTestApp()
    const anon = await clientWithCookie(app, "").call("POST", "/api/auth/2fa", { code: "123456" })
    expect(anon.status).toBe(401)

    const { me, secret } = await enable2fa(app, "full@example.com")
    // `me` signed in before enabling 2FA, so its session is already fully authenticated.
    const res = await me.call("POST", "/api/auth/2fa", { code: await totpCode(secret) })
    expect(res.status).toBe(400)
  })

  test("disable requires a valid code and restores normal sign-in", async () => {
    const { app } = await createTestApp()
    const { me, secret } = await enable2fa(app, "off@example.com")
    const good = await totpCode(secret)

    const wrong = await me.call("POST", "/api/me/2fa/disable", {
      code: good === "000000" ? "000001" : "000000",
    })
    expect(wrong.status).toBe(400)

    const off = await me.call("POST", "/api/me/2fa/disable", { code: good })
    expect(off.status).toBe(200)
    expect(off.body.user.totpEnabled).toBe(false)

    const login = await app.request("/api/auth/dev-login", json({ email: "off@example.com" }))
    expect(await login.json()).toMatchObject({ user: { email: "off@example.com" } })
  })
})

describe("two-factor guess limiting", () => {
  const wrongCode = async (secret: string) => {
    const good = await totpCode(secret)
    return good === "000000" ? "000001" : "000000"
  }

  async function userWith2fa(app: Awaited<ReturnType<typeof createTestApp>>["app"], email: string) {
    const me = await signIn(app, email)
    const { body } = await me.call("POST", "/api/me/2fa/setup")
    await me.call("POST", "/api/me/2fa/enable", { code: await totpCode(body.secret) })
    return { me, secret: body.secret as string }
  }

  test("five wrong codes destroy a pending session, even if the right code follows", async () => {
    const { app } = await createTestApp()
    const { secret } = await userWith2fa(app, "guess@example.com")
    const login = await app.request("/api/auth/dev-login", json({ email: "guess@example.com" }))
    const pending = clientWithCookie(app, sessionCookieFrom(login))
    const wrong = await wrongCode(secret)

    for (let i = 0; i < 4; i++) {
      expect((await pending.call("POST", "/api/auth/2fa", { code: wrong })).status).toBe(400)
    }
    const fifth = await pending.call("POST", "/api/auth/2fa", { code: wrong })
    expect(fifth.status).toBe(401)
    expect(fifth.body.code).toBe("UNAUTHORIZED")

    const late = await pending.call("POST", "/api/auth/2fa", { code: await totpCode(secret) })
    expect(late.status).toBe(401)
    // A fresh sign-in starts over.
    const again = await app.request("/api/auth/dev-login", json({ email: "guess@example.com" }))
    const fresh = clientWithCookie(app, sessionCookieFrom(again))
    expect(
      (await fresh.call("POST", "/api/auth/2fa", { code: await totpCode(secret) })).status,
    ).toBe(200)
  })

  test("a correct code resets the failure count", async () => {
    const { app } = await createTestApp()
    const { secret } = await userWith2fa(app, "reset@example.com")
    const wrong = await wrongCode(secret)
    for (let round = 0; round < 2; round++) {
      const login = await app.request("/api/auth/dev-login", json({ email: "reset@example.com" }))
      const pending = clientWithCookie(app, sessionCookieFrom(login))
      for (let i = 0; i < 4; i++) await pending.call("POST", "/api/auth/2fa", { code: wrong })
      const ok = await pending.call("POST", "/api/auth/2fa", { code: await totpCode(secret) })
      expect(ok.status).toBe(200)
    }
  })

  test("repeated wrong codes on disable lock the user out, even for the right code", async () => {
    const { app } = await createTestApp()
    const { me, secret } = await userWith2fa(app, "lock@example.com")
    const wrong = await wrongCode(secret)
    for (let i = 0; i < 5; i++) {
      expect((await me.call("POST", "/api/me/2fa/disable", { code: wrong })).status).toBe(400)
    }
    const locked = await me.call("POST", "/api/me/2fa/disable", { code: await totpCode(secret) })
    expect(locked.status).toBe(429)
    expect(locked.body.code).toBe("RATE_LIMITED")
    expect((await me.call("GET", "/api/me")).body.user.totpEnabled).toBe(true)
  })
})

describe("google sign-in", () => {
  test("start redirects to Google with state and PKCE and sets a short-lived cookie", async () => {
    const { app } = await createTestApp({ googleClientId: "cid", googleClientSecret: "sec" })
    const res = await app.request("/api/auth/google/start")
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get("location") ?? "")
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(location.searchParams.get("client_id")).toBe("cid")
    expect(location.searchParams.get("code_challenge_method")).toBe("S256")
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/google/callback",
    )
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("intesa_oauth=")) ?? ""
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain(`intesa_oauth=${location.searchParams.get("state")}.`)
  })

  test("callback with a mismatched state is rejected without creating a session", async () => {
    const { app, db } = await createTestApp({ googleClientId: "cid", googleClientSecret: "sec" })
    const res = await app.request("/api/auth/google/callback?code=abc&state=evil", {
      headers: { cookie: "intesa_oauth=good.verifier" },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/login?error=state_mismatch")
    expect(res.headers.getSetCookie().find((c) => c.startsWith("intesa_session="))).toBeUndefined()
    expect(await db.selectFrom("sessions").selectAll().execute()).toHaveLength(0)
  })

  test("callback without the state cookie is rejected", async () => {
    const { app } = await createTestApp({ googleClientId: "cid", googleClientSecret: "sec" })
    const res = await app.request("/api/auth/google/callback?code=abc&state=x")
    expect(res.headers.get("location")).toBe("/login?error=state_mismatch")
  })
})
