import { describe, expect, test } from "bun:test"
import {
  asksWhoDidIt,
  assigneeViews,
  joinNames,
  matchesAssignees,
  newTaskAssignees,
  stepAssigneeView,
  UNASSIGNED,
} from "../src"

const views = assigneeViews("me", ["ann", "me", "bob"])

describe("assigneeViews", () => {
  test("lists me first, the other members, Unassigned, then Everyone", () => {
    expect(views).toEqual([["me"], ["ann"], ["bob"], [UNASSIGNED], []])
  })

  test("skips 'me' until the current user is known", () => {
    expect(assigneeViews(undefined, ["ann"])).toEqual([["ann"], [UNASSIGNED], []])
  })
})

describe("stepAssigneeView", () => {
  test("moves to the next and previous view", () => {
    expect(stepAssigneeView(views, ["ann"], 1)).toEqual(["bob"])
    expect(stepAssigneeView(views, ["ann"], -1)).toEqual(["me"])
  })

  test("wraps around at both ends", () => {
    expect(stepAssigneeView(views, [], 1)).toEqual(["me"])
    expect(stepAssigneeView(views, ["me"], -1)).toEqual([])
  })

  test("a hand-picked selection enters at the first view going forward, the last going back", () => {
    expect(stepAssigneeView(views, ["ann", "bob"], 1)).toEqual(["me"])
    expect(stepAssigneeView(views, ["ann", "bob"], -1)).toEqual([])
  })

  test("matches a selection regardless of order", () => {
    const pair = [["a", "b"], ["c"]]
    expect(stepAssigneeView(pair, ["b", "a"], 1)).toEqual(["c"])
  })
})

describe("matchesAssignees", () => {
  const ann = { assignees: [{ id: "ann" }] }
  const nobody = { assignees: [] }

  test("an empty selection shows everyone's tasks", () => {
    expect(matchesAssignees(ann, [])).toBe(true)
    expect(matchesAssignees(nobody, [])).toBe(true)
  })

  test("a task shows when any of its assignees is selected; Unassigned shows nobody's", () => {
    expect(matchesAssignees({ assignees: [{ id: "bob" }, { id: "ann" }] }, ["ann"])).toBe(true)
    expect(matchesAssignees(ann, ["bob"])).toBe(false)
    expect(matchesAssignees(nobody, [UNASSIGNED])).toBe(true)
    expect(matchesAssignees(ann, [UNASSIGNED])).toBe(false)
  })
})

describe("newTaskAssignees", () => {
  test("the one person filtered to, nobody for Unassigned", () => {
    expect(newTaskAssignees(["ann"], "me")).toEqual(["ann"])
    expect(newTaskAssignees([UNASSIGNED], "me")).toEqual([])
  })

  test("otherwise the creator, when known", () => {
    expect(newTaskAssignees([], "me")).toEqual(["me"])
    expect(newTaskAssignees(["ann", "bob"], "me")).toEqual(["me"])
    expect(newTaskAssignees([], undefined)).toEqual([])
  })
})

describe("asksWhoDidIt", () => {
  const ada = { id: "ada" }
  const task = { status: "todo" as const, assignees: [ada] }

  test("someone else's task going into In progress, Review or Complete asks", () => {
    for (const status of ["in_progress", "review", "complete"] as const) {
      expect(asksWhoDidIt(task, status, "me")).toBe(true)
    }
  })

  test("not for Backlog or Todo, the same status, or nobody signed in", () => {
    expect(asksWhoDidIt({ ...task, status: "review" }, "todo", "me")).toBe(false)
    expect(asksWhoDidIt({ ...task, status: "review" }, "backlog", "me")).toBe(false)
    expect(asksWhoDidIt({ ...task, status: "review" }, "review", "me")).toBe(false)
    expect(asksWhoDidIt(task, "in_progress", undefined)).toBe(false)
  })

  test("not for unassigned tasks or the mover's own, however many others share it", () => {
    expect(asksWhoDidIt({ ...task, assignees: [] }, "review", "me")).toBe(false)
    expect(asksWhoDidIt({ ...task, assignees: [ada, { id: "me" }] }, "review", "me")).toBe(false)
    expect(asksWhoDidIt({ ...task, assignees: [ada, { id: "bo" }] }, "review", "me")).toBe(true)
  })
})

describe("joinNames", () => {
  test("reads as a sentence", () => {
    expect(joinNames([])).toBe("")
    expect(joinNames(["Ada"])).toBe("Ada")
    expect(joinNames(["Ada", "Grace"])).toBe("Ada and Grace")
    expect(joinNames(["Ada", "Grace", "Alan"])).toBe("Ada, Grace and Alan")
  })
})
