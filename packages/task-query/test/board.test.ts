import { describe, expect, test } from "bun:test"
import { isInPlace, type Placement, placeTask, type TaskStatus } from "../src"

const card = (id: string, status: TaskStatus, parentTaskId: string | null = null) => ({
  id,
  status,
  parentTaskId,
})

// Board order: columns are read top to bottom in list order.
const list = [
  card("a", "todo"),
  card("b", "todo"),
  card("sub", "todo", "a"),
  card("c", "todo"),
  card("d", "review"),
]
const ids = (placement: Placement, taskId = "a") =>
  placeTask(list, taskId, placement).map((t) => t.id)

describe("placeTask", () => {
  test("first and last move the task to either end of its column", () => {
    expect(ids("last")).toEqual(["b", "sub", "c", "a", "d"])
    expect(ids("first", "c")).toEqual(["c", "a", "b", "sub", "d"])
  })

  test("before and after put it next to another card of the column", () => {
    expect(ids({ before: "c" })).toEqual(["b", "sub", "a", "c", "d"])
    expect(ids({ after: "b" })).toEqual(["b", "a", "sub", "c", "d"])
  })

  test("subtasks are not part of the column, so they cannot be anchors", () => {
    expect(placeTask(list, "a", { before: "sub" })).toBe(list)
  })

  test("the list is returned as is when there is nothing to place it by", () => {
    expect(placeTask(list, "d", "first")).toBe(list)
    expect(placeTask(list, "missing", "first")).toBe(list)
    expect(placeTask(list, "a", { after: "d" })).toBe(list)
  })
})

describe("isInPlace", () => {
  const at = (id: string, placement: Placement) =>
    isInPlace(list, list.find((t) => t.id === id) as (typeof list)[number], placement)

  test("first and last are in place at either end of the column", () => {
    expect(at("a", "first")).toBe(true)
    expect(at("c", "last")).toBe(true)
    expect(at("b", "first")).toBe(false)
  })

  test("next to the card it already sits by, skipping subtasks", () => {
    expect(at("b", { before: "c" })).toBe(true)
    expect(at("c", { after: "b" })).toBe(true)
    expect(at("a", { before: "c" })).toBe(false)
    expect(at("a", { before: "a" })).toBe(true)
  })
})
