import { describe, expect, test } from "bun:test"
import { byBoardOrder } from "../src/tasks/order"
import { createTestApp, setupProject, signIn } from "./helpers"

async function setup() {
  const t = await createTestApp()
  const ctx = await setupProject(t, "owner@example.com")
  const create = async (title: string, status = "todo", extra: Record<string, unknown> = {}) => {
    const res = await ctx.owner.call("POST", `/api/projects/${ctx.project.id}/tasks`, {
      title,
      status,
      ...extra,
    })
    expect(res.status).toBe(201)
    return res.body.task as { id: string; title: string }
  }
  const patch = (id: string, body: Record<string, unknown>) =>
    ctx.owner.call("PATCH", `/api/tasks/${id}`, body)
  // Titles in board order, one status column.
  const column = async (status: string) => {
    const res = await ctx.owner.call("GET", `/api/projects/${ctx.project.id}/tasks`)
    return (res.body.tasks as { title: string; status: string }[])
      .filter((x) => x.status === status)
      .map((x) => x.title)
  }
  return { t, ...ctx, create, patch, column }
}

describe("board order", () => {
  test("new tasks go to the top of their column", async () => {
    const { create, column } = await setup()
    await create("a")
    await create("b")
    await create("c")
    await create("other", "review")
    expect(await column("todo")).toEqual(["c", "b", "a"])
    expect(await column("review")).toEqual(["other"])
  })

  test("a task can be placed before or after another, or at either end", async () => {
    const { create, patch, column } = await setup()
    const a = await create("a")
    const b = await create("b")
    const c = await create("c")
    const d = await create("d")
    expect(await column("todo")).toEqual(["d", "c", "b", "a"])

    expect((await patch(a.id, { placement: { before: d.id } })).status).toBe(200)
    expect(await column("todo")).toEqual(["a", "d", "c", "b"])

    expect((await patch(a.id, { placement: { after: c.id } })).status).toBe(200)
    expect(await column("todo")).toEqual(["d", "c", "a", "b"])

    expect((await patch(d.id, { placement: "last" })).status).toBe(200)
    expect(await column("todo")).toEqual(["c", "a", "b", "d"])

    expect((await patch(b.id, { placement: "first" })).status).toBe(200)
    expect(await column("todo")).toEqual(["b", "c", "a", "d"])
  })

  test("moving to the position it is already in changes nothing", async () => {
    const { create, patch, column } = await setup()
    const a = await create("a")
    const b = await create("b")
    await create("c")
    expect(await column("todo")).toEqual(["c", "b", "a"])
    expect((await patch(b.id, { placement: { after: a.id } })).status).toBe(200)
    expect(await column("todo")).toEqual(["c", "a", "b"])
    expect((await patch(b.id, { placement: { after: a.id } })).status).toBe(200)
    expect(await column("todo")).toEqual(["c", "a", "b"])
  })

  test("reordering is not an edit: updatedAt stays, and no history is written", async () => {
    const { owner, create, patch } = await setup()
    const a = await create("a")
    const b = await create("b")
    const before = (await owner.call("GET", `/api/tasks/${a.id}`)).body.task
    expect((await patch(a.id, { placement: { before: b.id } })).status).toBe(200)
    const after = (await owner.call("GET", `/api/tasks/${a.id}`)).body.task
    expect(after.updatedAt).toBe(before.updatedAt)
    const history = await owner.call("GET", `/api/tasks/${a.id}/history`)
    expect(history.body.history).toHaveLength(1)
  })

  test("a status change with a placement moves the task into that spot and records history", async () => {
    const { owner, create, patch, column } = await setup()
    const a = await create("a")
    const x = await create("x", "review")
    await create("y", "review")
    expect(await column("review")).toEqual(["y", "x"])

    const res = await patch(a.id, { status: "review", placement: { after: x.id } })
    expect(res.status).toBe(200)
    expect(res.body.task.status).toBe("review")
    expect(await column("review")).toEqual(["y", "x", "a"])
    expect(await column("todo")).toEqual([])

    const history = await owner.call("GET", `/api/tasks/${a.id}/history`)
    expect(history.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      "todo",
      "review",
    ])
  })

  test("a status change without a placement lands at the top of the new column", async () => {
    const { create, patch, column } = await setup()
    const a = await create("a")
    await create("x", "review")
    await create("y", "review")
    expect((await patch(a.id, { status: "review" })).status).toBe(200)
    expect(await column("review")).toEqual(["a", "y", "x"])
  })

  test("the anchor is looked up in the column the task ends up in", async () => {
    const { create, patch, column } = await setup()
    const a = await create("a")
    const x = await create("x", "review")
    // x is in review, so it is a valid anchor only together with the move to review.
    expect((await patch(a.id, { placement: { before: x.id } })).status).toBe(400)
    expect((await patch(a.id, { status: "review", placement: { before: x.id } })).status).toBe(200)
    expect(await column("review")).toEqual(["a", "x"])
  })

  test("rejects an anchor that is the task itself, unknown, or in another project", async () => {
    const { owner, workspaceId, create, patch, column } = await setup()
    const a = await create("a")
    await create("b")
    const other = await owner.call("POST", `/api/workspaces/${workspaceId}/projects`, {
      name: "Other",
    })
    const foreign = await owner.call("POST", `/api/projects/${other.body.project.id}/tasks`, {
      title: "foreign",
    })

    for (const placement of [
      { before: a.id },
      { after: a.id },
      { before: "no-such-task" },
      { after: foreign.body.task.id },
    ]) {
      const res = await patch(a.id, { placement })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe("VALIDATION_ERROR")
    }
    expect(await column("todo")).toEqual(["b", "a"])
  })

  test("a rejected placement rolls back the rest of the patch", async () => {
    const { owner, create, patch } = await setup()
    const a = await create("a")
    const res = await patch(a.id, {
      title: "renamed",
      status: "review",
      placement: { before: "x" },
    })
    expect(res.status).toBe(400)
    const task = (await owner.call("GET", `/api/tasks/${a.id}`)).body.task
    expect(task).toMatchObject({ title: "a", status: "todo" })
    const history = await owner.call("GET", `/api/tasks/${a.id}/history`)
    expect(history.body.history).toHaveLength(1)
  })

  test("rejects malformed placements", async () => {
    const { create, patch } = await setup()
    const a = await create("a")
    const b = await create("b")
    for (const placement of [
      "middle",
      {},
      { before: "" },
      { before: b.id, after: b.id },
      { before: 5 },
      null,
    ]) {
      expect((await patch(a.id, { placement })).status).toBe(400)
    }
  })

  test("only workspace members can reorder", async () => {
    const { t, create, patch } = await setup()
    const a = await create("a")
    const b = await create("b")
    const stranger = await signIn(t.app, "stranger@example.com")
    const res = await stranger.call("PATCH", `/api/tasks/${a.id}`, { placement: { before: b.id } })
    expect(res.status).toBe(404)
    expect((await patch(a.id, { placement: "last" })).status).toBe(200)
  })

  test("many moves into the same spot keep a consistent order", async () => {
    const { create, patch, column } = await setup()
    const anchor = await create("anchor")
    const first = await create("first")
    const titles: string[] = []
    // Each task is dropped directly above the anchor, i.e. into an ever narrower gap.
    for (let i = 0; i < 40; i++) {
      const task = await create(`t${i}`)
      expect((await patch(task.id, { placement: { before: anchor.id } })).status).toBe(200)
      titles.push(task.title)
    }
    expect((await patch(first.id, { placement: "last" })).status).toBe(200)
    expect(await column("todo")).toEqual([...titles, "anchor", "first"])
  })

  test("equal keys from racing moves are respaced on the next move", async () => {
    const { t, create, patch, column } = await setup()
    const a = await create("a")
    const b = await create("b")
    const c = await create("c")
    const d = await create("d")
    expect(await column("todo")).toEqual(["d", "c", "b", "a"])

    // What two clients dropping into the same gap leave behind: b, c and d share one key.
    const { position } = await t.db
      .selectFrom("tasks")
      .select("position")
      .where("id", "=", c.id)
      .executeTakeFirstOrThrow()
    await t.db.updateTable("tasks").set({ position }).where("id", "in", [b.id, d.id]).execute()
    // Ties show newest first, so the list is still stable.
    expect(await column("todo")).toEqual(["d", "c", "b", "a"])

    // Squeezing a between the tied c and b has no room; the column is respaced.
    expect((await patch(a.id, { placement: { after: c.id } })).status).toBe(200)
    expect(await column("todo")).toEqual(["d", "c", "a", "b"])
    const rows = await t.db.selectFrom("tasks").select("position").execute()
    expect(new Set(rows.map((r) => r.position)).size).toBe(4)
  })

  test("a key that is not a valid fractional index is replaced rather than failing", async () => {
    const { t, create, patch, column } = await setup()
    const a = await create("a")
    const b = await create("b")
    await t.db.updateTable("tasks").set({ position: "" }).execute()
    expect((await patch(a.id, { placement: { before: b.id } })).status).toBe(200)
    expect(await column("todo")).toEqual(["a", "b"])
  })

  test("a manual order survives other edits to the task", async () => {
    const { create, patch, column } = await setup()
    const a = await create("a")
    await create("b")
    await create("c")
    await patch(a.id, { placement: "first" })
    expect(await column("todo")).toEqual(["a", "c", "b"])
    await patch(a.id, { title: "a2", priority: "high" })
    expect(await column("todo")).toEqual(["a2", "c", "b"])
  })

  test("a task can only be placed among tasks with the same parent", async () => {
    const { create, patch, column } = await setup()
    const parent = await create("parent")
    const child = await create("child", "todo", { parentTaskId: parent.id })
    const other = await create("other")
    expect((await patch(other.id, { placement: { before: child.id } })).status).toBe(400)
    expect((await patch(child.id, { placement: { after: other.id } })).status).toBe(400)
    expect(await column("todo")).toEqual(["other", "parent"])
  })

  test("a status change without a placement leaves the rest of the new column alone", async () => {
    const { create, patch, column } = await setup()
    const a = await create("a")
    await create("x", "review")
    await create("y", "review")
    const before = await column("review")
    await patch(a.id, { status: "review" })
    expect((await column("review")).slice(1)).toEqual(before)
  })

  test("patching the status a task already has does not move it", async () => {
    const { create, patch, column } = await setup()
    await create("a")
    const b = await create("b")
    await create("c")
    await patch(b.id, { status: "todo" })
    expect(await column("todo")).toEqual(["c", "b", "a"])
  })
})

describe("byBoardOrder", () => {
  test("compares keys as plain strings, uppercase before lowercase", () => {
    // ASCII order, whatever the database collation would say.
    const keys = ["a0", "Zz", "a1", "a00", "B", "b"].map((position, number) => ({
      position,
      number,
    }))
    expect(keys.sort(byBoardOrder).map((k) => k.position)).toEqual([
      "B",
      "Zz",
      "a0",
      "a00",
      "a1",
      "b",
    ])
  })

  test("ties are broken by newest task first", () => {
    const rows = [
      { position: "a0", number: 1 },
      { position: "a0", number: 3 },
      { position: "a0", number: 2 },
    ]
    expect(rows.sort(byBoardOrder).map((r) => r.number)).toEqual([3, 2, 1])
  })
})
