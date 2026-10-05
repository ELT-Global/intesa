import { describe, expect, test } from "bun:test"
import { createApp } from "../src/app"

describe("api", () => {
  const app = createApp()

  test("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test("unknown /api route returns 404 JSON", async () => {
    const res = await app.request("/api/nope")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: "NOT_FOUND", message: "Not found" })
  })
})
