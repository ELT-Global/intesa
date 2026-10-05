import { describe, expect, test } from "bun:test"
import { createTestApp, setupProject, signIn } from "./helpers"

async function setup() {
  const t = await createTestApp()
  const ctx = await setupProject(t, "owner@example.com")
  const make = async (title: string) =>
    (await ctx.owner.call("POST", `/api/projects/${ctx.project.id}/tasks`, { title })).body
      .task as {
      id: string
      key: string
    }
  const [a, b, c] = [await make("A"), await make("B"), await make("C")] as [
    { id: string; key: string },
    { id: string; key: string },
    { id: string; key: string },
  ]
  const link = (from: { id: string }, type: string, to: { id: string }) =>
    ctx.owner.call("POST", `/api/tasks/${from.id}/relationships`, { type, taskId: to.id })
  const detail = async (task: { id: string }) =>
    (await ctx.owner.call("GET", `/api/tasks/${task.id}`)).body.task
  const rows = () => t.db.selectFrom("taskRelationships").selectAll().execute()
  return { t, ...ctx, make, a, b, c, link, detail, rows }
}

describe("relationships", () => {
  test("A blocks B shows on both sides and stores one row", async () => {
    const { a, b, link, detail, rows } = await setup()
    const res = await link(a, "blocks", b)
    expect(res.status).toBe(201)
    expect(res.body.task.blocks).toEqual([{ id: b.id, key: b.key, title: "B", status: "todo" }])

    expect((await detail(a)).blocks.map((r: { id: string }) => r.id)).toEqual([b.id])
    expect((await detail(b)).blockedBy.map((r: { id: string }) => r.id)).toEqual([a.id])
    expect((await detail(b)).blocks).toEqual([])
    expect(await rows()).toHaveLength(1)
  })

  test("blocked_by stores the other task as the blocker", async () => {
    const { a, b, link, detail, rows } = await setup()
    const res = await link(b, "blocked_by", a)
    expect(res.status).toBe(201)
    expect(res.body.task.blockedBy.map((r: { id: string }) => r.id)).toEqual([a.id])
    expect((await detail(a)).blocks.map((r: { id: string }) => r.id)).toEqual([b.id])
    const [row] = await rows()
    expect(row).toMatchObject({ sourceTaskId: a.id, targetTaskId: b.id, type: "blocks" })
  })

  test("related shows on both sides from a single row", async () => {
    const { a, b, link, detail, rows } = await setup()
    await link(a, "related", b)
    expect((await detail(a)).related.map((r: { id: string }) => r.id)).toEqual([b.id])
    expect((await detail(b)).related.map((r: { id: string }) => r.id)).toEqual([a.id])
    expect(await rows()).toHaveLength(1)
  })

  test("duplicates are 409, including a reversed related", async () => {
    const { a, b, link, rows } = await setup()
    await link(a, "related", b)
    expect((await link(a, "related", b)).status).toBe(409)
    const reversed = await link(b, "related", a)
    expect(reversed.status).toBe(409)
    expect(reversed.body.code).toBe("CONFLICT")

    await link(a, "blocks", b)
    expect((await link(a, "blocks", b)).status).toBe(409)
    expect((await link(b, "blocked_by", a)).status).toBe(409)
    expect(await rows()).toHaveLength(2)
  })

  test("a direct cycle is rejected", async () => {
    const { a, b, link, rows } = await setup()
    await link(a, "blocks", b)
    const back = await link(b, "blocks", a)
    expect(back.status).toBe(409)
    expect((await link(a, "blocked_by", b)).status).toBe(409)
    expect(await rows()).toHaveLength(1)
  })

  test("a task cannot relate to itself", async () => {
    const { a, link } = await setup()
    const res = await link(a, "related", a)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })

  test("tasks in other workspaces and unknown tasks are 404", async () => {
    const { t, a, link } = await setup()
    const other = await setupProject(t, "other@example.com")
    const foreign = await other.owner.call("POST", `/api/projects/${other.project.id}/tasks`, {
      title: "Foreign",
    })
    // Linking across workspaces looks the same as linking to a missing task.
    const res = await link(a, "blocks", foreign.body.task)
    expect(res.status).toBe(404)
    expect((await link(a, "blocks", { id: "nope" })).status).toBe(404)
  })

  test("outsiders cannot read or write relationships", async () => {
    const { t, a, b, link } = await setup()
    await link(a, "blocks", b)
    const outsider = await signIn(t.app, "out@example.com")
    expect(
      (
        await outsider.call("POST", `/api/tasks/${a.id}/relationships`, {
          type: "related",
          taskId: b.id,
        })
      ).status,
    ).toBe(404)
    expect(
      (await outsider.call("DELETE", `/api/tasks/${a.id}/relationships/${b.id}?type=blocks`))
        .status,
    ).toBe(404)
  })

  test("rejects an invalid type", async () => {
    const { a, b, link } = await setup()
    expect((await link(a, "duplicates", b)).status).toBe(400)
  })

  test("deleting from either side removes the relationship", async () => {
    const { owner, a, b, c, link, detail, rows } = await setup()
    await link(a, "blocks", b)
    await link(a, "related", c)

    // From the blocker's side.
    const first = await owner.call("DELETE", `/api/tasks/${a.id}/relationships/${b.id}?type=blocks`)
    expect(first.status).toBe(200)
    expect(first.body.task.blocks).toEqual([])
    expect((await detail(b)).blockedBy).toEqual([])

    // From the blocked side.
    await link(a, "blocks", b)
    const second = await owner.call(
      "DELETE",
      `/api/tasks/${b.id}/relationships/${a.id}?type=blocked_by`,
    )
    expect(second.body.task.blockedBy).toEqual([])
    expect((await detail(a)).blocks).toEqual([])

    // A related link can be removed from the side that did not create it.
    const third = await owner.call(
      "DELETE",
      `/api/tasks/${c.id}/relationships/${a.id}?type=related`,
    )
    expect(third.body.task.related).toEqual([])
    expect(await rows()).toHaveLength(0)
  })

  test("deleting something that does not exist is 404; a missing type is 400", async () => {
    const { owner, a, b } = await setup()
    expect(
      (await owner.call("DELETE", `/api/tasks/${a.id}/relationships/${b.id}?type=blocks`)).status,
    ).toBe(404)
    expect((await owner.call("DELETE", `/api/tasks/${a.id}/relationships/${b.id}`)).status).toBe(
      400,
    )
  })

  test("deleting a task removes its relationships", async () => {
    const { owner, a, b, link, detail } = await setup()
    await link(a, "blocks", b)
    await owner.call("DELETE", `/api/tasks/${a.id}`)
    expect((await detail(b)).blockedBy).toEqual([])
  })

  test("related tasks carry their current status", async () => {
    const { owner, a, b, link, detail } = await setup()
    await link(a, "related", b)
    await owner.call("PATCH", `/api/tasks/${b.id}`, { status: "complete" })
    expect((await detail(a)).related[0]).toMatchObject({ id: b.id, status: "complete" })
  })
})

describe("task search", () => {
  test("matches titles and keys within the workspace, capped at 20", async () => {
    const { t, owner, workspaceId, project, make } = await setup()
    await owner.call("POST", `/api/projects/${project.id}/tasks`, { title: "Fix login bug" })
    const url = `/api/workspaces/${workspaceId}/tasks/search`

    const byTitle = await owner.call("GET", `${url}?q=LOGIN`)
    expect(byTitle.body.tasks.map((x: { title: string }) => x.title)).toEqual(["Fix login bug"])
    expect(byTitle.body.tasks[0]).toMatchObject({ key: `${project.key}-4`, status: "todo" })

    const byKey = await owner.call("GET", `${url}?q=${project.key.toLowerCase()}-2`)
    expect(byKey.body.tasks.map((x: { title: string }) => x.title)).toEqual(["B"])

    for (let i = 0; i < 25; i++) await make(`bulk ${i}`)
    expect((await owner.call("GET", `${url}?q=bulk`)).body.tasks).toHaveLength(20)
    expect((await owner.call("GET", url)).body.tasks).toHaveLength(20)

    // Work in another workspace never appears.
    const other = await setupProject(t, "other@example.com")
    await other.owner.call("POST", `/api/projects/${other.project.id}/tasks`, {
      title: "login elsewhere",
    })
    expect((await owner.call("GET", `${url}?q=elsewhere`)).body.tasks).toEqual([])
  })

  test("wildcard characters in the query are literal", async () => {
    const { owner, workspaceId } = await setup()
    const res = await owner.call("GET", `/api/workspaces/${workspaceId}/tasks/search?q=%25`)
    expect(res.body.tasks).toEqual([])
  })

  test("is 404 for outsiders", async () => {
    const { t, workspaceId } = await setup()
    const outsider = await signIn(t.app, "out@example.com")
    expect(
      (await outsider.call("GET", `/api/workspaces/${workspaceId}/tasks/search?q=a`)).status,
    ).toBe(404)
  })
})

describe("relationship integrity", () => {
  test("a longer block cycle is rejected (A -> B -> C -> A)", async () => {
    const { a, b, c, link, rows } = await setup()
    expect((await link(a, "blocks", b)).status).toBe(201)
    expect((await link(b, "blocks", c)).status).toBe(201)

    const closing = await link(c, "blocks", a)
    expect(closing.status).toBe(409)
    expect(closing.body.code).toBe("CONFLICT")
    expect((await link(a, "blocked_by", c)).status).toBe(409)
    expect(await rows()).toHaveLength(2)
  })

  test("non-cyclic shapes are fine: diamonds and shared blockers", async () => {
    const { a, b, c, make, link } = await setup()
    const d = await make("D")
    for (const [from, to] of [
      [a, b],
      [a, c],
      [b, d],
      [c, d],
    ] as const) {
      expect((await link(from, "blocks", to)).status).toBe(201)
    }
    expect((await link(d, "blocks", a)).status).toBe(409)
  })

  test("related links do not take part in cycle checks", async () => {
    const { a, b, link } = await setup()
    await link(a, "related", b)
    expect((await link(a, "blocks", b)).status).toBe(201)
    expect((await link(b, "related", a)).status).toBe(409)
  })

  test("two simultaneous identical links produce one row and one conflict", async () => {
    const { a, b, link, rows } = await setup()
    const results = await Promise.all([link(a, "blocks", b), link(a, "blocks", b)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await rows()).toHaveLength(1)
  })

  test("two simultaneous opposite blocks cannot both succeed", async () => {
    const { a, b, link, rows } = await setup()
    const results = await Promise.all([link(a, "blocks", b), link(b, "blocks", a)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await rows()).toHaveLength(1)
  })
})
