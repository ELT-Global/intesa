import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { createApp } from "../src/app"
import { createDb, migrate } from "../src/db"
import { signIn } from "./helpers"

// These tests break their database on purpose, so they always get a private in-memory one.
async function createTestApp() {
  const db = await createDb(":memory:")
  await migrate(db)
  const config = {
    nodeEnv: "test",
    devLogin: true,
    publicUrl: "http://localhost",
    secureCookies: false,
  }
  return { app: createApp({ db, config }), db }
}

let errors: ReturnType<typeof spyOn<Console, "error">>

beforeEach(() => {
  errors = spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => errors.mockRestore())

const logged = () => errors.mock.calls.map((c) => String(c[0]))

describe("request logging", () => {
  test("a server failure is logged with method, path, status and duration only", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "log@example.com")
    // Breaking the database makes the next authenticated request fail with a 500.
    await t.db.schema.dropTable("sessions").execute()

    const res = await me.call("GET", "/api/me?secret=abc")
    expect(res.status).toBe(500)

    const entry = logged()
      .map((line) => JSON.parse(line))
      .find((l) => l.msg === "request failed")
    expect(entry).toMatchObject({
      level: "error",
      method: "GET",
      path: "/api/me",
      status: 500,
    })
    expect(typeof entry.durationMs).toBe("number")
    // Nothing from the request leaks into the log line.
    const raw = logged().find((l) => l.includes("request failed")) ?? ""
    expect(raw).not.toContain("secret=abc")
    expect(raw).not.toContain("intesa_session")
    expect(raw).not.toContain(me.cookie.split("=")[1] ?? "x-none")
  })

  test("client errors are not logged", async () => {
    const { app } = await createTestApp()
    expect((await app.request("/api/me")).status).toBe(401)
    expect((await app.request("/api/nope")).status).toBe(404)
    expect(logged().filter((l) => l.includes("request failed"))).toEqual([])
  })

  test("health reports a broken database as a failure", async () => {
    const t = await createTestApp()
    expect((await t.app.request("/api/health")).status).toBe(200)
    await t.db.destroy()
    expect((await t.app.request("/api/health")).status).toBe(500)
  })
})
