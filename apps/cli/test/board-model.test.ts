import { describe, expect, test } from "bun:test"
import type { Task } from "../src/tui/api"
import { applyChanges, revert } from "../src/tui/model"

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
