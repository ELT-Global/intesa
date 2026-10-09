import { describe, expect, test } from "bun:test"
import { timeAgo } from "../src/lib/time"

const NOW = Date.parse("2026-10-09T12:00:00Z")
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000

describe("timeAgo", () => {
  test("under a minute, and clock skew into the future, read as just now", () => {
    expect(timeAgo(ago(30_000), NOW)).toBe("just now")
    expect(timeAgo(ago(-5 * MIN), NOW)).toBe("just now")
  })

  test("minutes, hours and days", () => {
    expect(timeAgo(ago(5 * MIN), NOW)).toBe("5m ago")
    expect(timeAgo(ago(119 * MIN), NOW)).toBe("1h ago")
    expect(timeAgo(ago(26 * 60 * MIN), NOW)).toBe("1d ago")
    expect(timeAgo(ago(29 * 24 * 60 * MIN), NOW)).toBe("29d ago")
  })

  test("a month or more falls back to the date", () => {
    expect(timeAgo(ago(45 * 24 * 60 * MIN), NOW)).not.toMatch(/ago$/)
  })
})
