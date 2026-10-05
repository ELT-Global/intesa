import { describe, expect, test } from "bun:test"
import { createAttemptLimiter } from "../src/auth/attempts"

describe("attempt limiter", () => {
  test("allows the budget, flags the last try, then locks", () => {
    const limiter = createAttemptLimiter(3, 1000, () => 0)
    expect([limiter.take("u"), limiter.take("u"), limiter.take("u")]).toEqual(["ok", "ok", "last"])
    expect(limiter.take("u")).toBe("locked")
    expect(limiter.take("other")).toBe("ok")
  })

  test("the lock lasts until the window after the last try has passed", () => {
    let time = 0
    const limiter = createAttemptLimiter(2, 1000, () => time)
    limiter.take("u")
    limiter.take("u")
    time = 999
    expect(limiter.take("u")).toBe("locked")
    time = 1000
    expect(limiter.take("u")).toBe("ok")
  })

  test("reset gives the budget back", () => {
    const limiter = createAttemptLimiter(2, 1000, () => 0)
    limiter.take("u")
    limiter.reset("u")
    expect([limiter.take("u"), limiter.take("u")]).toEqual(["ok", "last"])
  })

  test("expired entries are pruned so the map cannot grow without bound", () => {
    let time = 0
    const limiter = createAttemptLimiter(5, 1000, () => time)
    for (let i = 0; i < 100; i++) limiter.take(`user-${i}`)
    expect(limiter.size()).toBe(100)
    time = 5000
    limiter.take("fresh")
    expect(limiter.size()).toBe(1)
  })
})
