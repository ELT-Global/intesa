import { describe, expect, test } from "bun:test"
import { assigneeViews, stepAssigneeView } from "../src/lib/assignee-views"

const views = assigneeViews("me", ["ann", "me", "bob"], "unassigned")

describe("assigneeViews", () => {
  test("lists me first, the other members, Unassigned, then Everyone", () => {
    expect(views).toEqual([["me"], ["ann"], ["bob"], ["unassigned"], []])
  })

  test("skips 'me' until the current user is known", () => {
    expect(assigneeViews(undefined, ["ann"], "unassigned")).toEqual([["ann"], ["unassigned"], []])
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
