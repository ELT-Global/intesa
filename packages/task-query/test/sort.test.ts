import { describe, expect, test } from "bun:test"
import { compareBy, nextSort, type Sort, type TaskPriority } from "../src"

const task = (title: string, priority: TaskPriority | null, dueAt: string | null = null) => ({
  title,
  status: "todo" as const,
  priority,
  dueAt,
})
const list = [task("bravo", "low"), task("Alpha", null, "2030-01-02"), task("charlie", "urgent")]
const titles = (sort: Sort) => [...list].sort(compareBy(sort)).map((t) => t.title)

describe("compareBy", () => {
  test("sorts by title regardless of case", () => {
    expect(titles({ key: "task", dir: "asc" })).toEqual(["Alpha", "bravo", "charlie"])
    expect(titles({ key: "task", dir: "desc" })).toEqual(["charlie", "bravo", "Alpha"])
  })

  test("missing values sort last in both directions", () => {
    expect(titles({ key: "priority", dir: "asc" })).toEqual(["charlie", "bravo", "Alpha"])
    expect(titles({ key: "priority", dir: "desc" })).toEqual(["bravo", "charlie", "Alpha"])
    expect(titles({ key: "due", dir: "desc" })).toEqual(["Alpha", "bravo", "charlie"])
  })
})

describe("nextSort", () => {
  test("a new key starts ascending; the same key again flips", () => {
    expect(nextSort(null, "due")).toEqual({ key: "due", dir: "asc" })
    expect(nextSort({ key: "due", dir: "asc" }, "due")).toEqual({ key: "due", dir: "desc" })
    expect(nextSort({ key: "due", dir: "desc" }, "due")).toEqual({ key: "due", dir: "asc" })
    expect(nextSort({ key: "due", dir: "desc" }, "task")).toEqual({ key: "task", dir: "asc" })
  })
})
