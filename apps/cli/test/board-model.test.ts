import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"
import type { Task } from "../src/tui/api"
import { applyChanges, expandPath, revert, splitPaths } from "../src/tui/model"

const card = (id: string, status: Task["status"] = "todo") =>
  ({ id, status, priority: null, parentTaskId: null }) as unknown as Task
const ids = (list: Task[]) => list.map((t) => t.id)

describe("revert", () => {
  test("an edit that moved the card puts it back where it was", () => {
    const list = [card("c", "review"), card("a"), card("b")]
    // To the top of Review, as the server puts it.
    const { list: moved, undo } = applyChanges(list, "b", { status: "review" })
    expect(ids(moved)).toEqual(["b", "c", "a"])
    const back = revert(moved, "b", undo ?? { fields: {} })
    expect(ids(back)).toEqual(["c", "a", "b"])
    expect(back[2]?.status).toBe("todo")
  })

  test("an edit that did not move it leaves the card where it is now", () => {
    const list = [card("a"), card("b"), card("c")]
    const { undo } = applyChanges(list, "b", { priority: "high" })
    // Meanwhile another change moved it to the top.
    const now = [{ ...card("b"), priority: "high" as const }, card("a"), card("c")]
    const back = revert(now, "b", undo ?? { fields: {} })
    expect(ids(back)).toEqual(["b", "a", "c"])
    expect(back[0]?.priority).toBeNull()
  })
})

describe("upload paths", () => {
  test("split on spaces, with quotes around paths that hold them", () => {
    expect(splitPaths(` a.md  "my files/b.pdf" 'c d.html'`)).toEqual([
      "a.md",
      "my files/b.pdf",
      "c d.html",
    ])
    expect(splitPaths(`""  `)).toEqual([])
  })

  test("~ is the home directory; other paths are relative to the working directory", () => {
    const cwd = resolve("/work")
    const home = resolve("/home/alan")
    expect(expandPath("~", cwd, home)).toBe(home)
    expect(expandPath("~/notes.md", cwd, home)).toBe(join(home, "notes.md"))
    expect(expandPath("~\\notes.md", cwd, home)).toBe(join(home, "notes.md"))
    expect(expandPath("docs/a.md", cwd, home)).toBe(join(cwd, "docs", "a.md"))
    expect(expandPath("~alan/a.md", cwd, home)).toBe(join(cwd, "~alan", "a.md"))
  })

  test("on Windows, a Git Bash path names the drive", () => {
    expect(expandPath("/c/Users/alan/a.md", "D:\\work", "C:\\Users\\alan", "win32")).toBe(
      "C:\\Users\\alan\\a.md",
    )
    expect(expandPath("/d", "C:\\work", "C:\\Users\\alan", "win32")).toBe("D:\\")
    expect(expandPath("/c/a.md", "/work", "/home/alan", "linux")).toBe("/c/a.md")
  })
})
