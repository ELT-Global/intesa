import { describe, expect, test } from "bun:test"
import { dayFromToday, daysUntil, dueState } from "../src"

// Mid-afternoon: due dates are whole days, so the time of day must not tip the result.
const NOW = new Date(2026, 5, 15, 15, 30)

describe("dueState", () => {
  test("a day in the past is overdue, today is not", () => {
    expect(dueState("2026-06-14", "todo", NOW)).toBe("overdue")
    expect(dueState("2026-06-15", "todo", NOW)).toBe("soon")
  })

  test("soon covers today and the two days after, then it is neutral", () => {
    expect(dueState("2026-06-17", "todo", NOW)).toBe("soon")
    expect(dueState("2026-06-18", "todo", NOW)).toBe("neutral")
  })

  test("completed work is never overdue or soon", () => {
    expect(dueState("2026-01-01", "complete", NOW)).toBe("neutral")
    expect(dueState("2026-06-15", "complete", NOW)).toBe("neutral")
  })

  test("counts calendar days across a month end", () => {
    const now = new Date(2026, 0, 31, 23, 59)
    expect(dueState("2026-02-02", "todo", now)).toBe("soon")
    expect(dueState("2026-02-03", "todo", now)).toBe("neutral")
  })
})

describe("dayFromToday", () => {
  test("zero is today, zero-padded", () => {
    expect(dayFromToday(0, new Date(2026, 2, 5, 22))).toBe("2026-03-05")
  })

  test("offsets cross month and year boundaries both ways", () => {
    expect(dayFromToday(1, new Date(2026, 11, 31))).toBe("2027-01-01")
    expect(dayFromToday(-1, new Date(2026, 2, 1))).toBe("2026-02-28")
    expect(dayFromToday(7, new Date(2026, 5, 28))).toBe("2026-07-05")
  })
})

describe("daysUntil", () => {
  test("whole calendar days, whatever the time of day", () => {
    expect(daysUntil("2026-06-15", NOW)).toBe(0)
    expect(daysUntil("2026-06-16", NOW)).toBe(1)
    expect(daysUntil("2026-06-13", NOW)).toBe(-2)
    expect(daysUntil("2026-07-01", NOW)).toBe(16)
  })
})
