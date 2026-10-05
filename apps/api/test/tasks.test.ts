import { describe, expect, test } from "bun:test"
import { loadTaskSummaries } from "../src/tasks/service"
import { addMember, addTag, createTestApp, setupProject, signIn, userId } from "./helpers"

async function setup(email = "owner@example.com") {
  const t = await createTestApp()
  const ctx = await setupProject(t, email)
  const create = async (body: Record<string, unknown> = { title: "Task" }) => {
    const res = await ctx.owner.call("POST", `/api/projects/${ctx.project.id}/tasks`, body)
    expect(res.status).toBe(201)
    return res.body.task as { id: string; number: number; key: string }
  }
  return { t, ...ctx, create }
}

describe("task creation", () => {
  test("applies defaults and records the initial history row", async () => {
    const { owner, project, create } = await setup()
    const task = await create({ title: "  First  " })
    const res = await owner.call("GET", `/api/tasks/${task.id}`)
    expect(res.body.task).toMatchObject({
      title: "First",
      status: "todo",
      priority: null,
      dueAt: null,
      body: null,
      parentTaskId: null,
      assignees: [],
      tags: [],
      subtaskCount: 0,
      subtaskDoneCount: 0,
      key: `${project.key}-1`,
      project: { id: project.id, name: "Website", key: project.key },
      parent: null,
      subtasks: [],
    })

    const history = await owner.call("GET", `/api/tasks/${task.id}/history`)
    expect(history.body.history).toHaveLength(1)
    expect(history.body.history[0]).toMatchObject({
      fromStatus: null,
      toStatus: "todo",
      updatedBy: { name: "owner" },
    })
  })

  test("numbers increment per project and are independent between projects", async () => {
    const { owner, workspaceId, project, create } = await setup()
    const a = await create()
    const b = await create()
    expect([a.number, b.number]).toEqual([1, 2])
    expect(b.key).toBe(`${project.key}-2`)

    const other = await owner.call("POST", `/api/workspaces/${workspaceId}/projects`, {
      name: "Other",
    })
    const first = await owner.call("POST", `/api/projects/${other.body.project.id}/tasks`, {
      title: "x",
    })
    expect(first.body.task.number).toBe(1)
  })

  test("concurrent creates never share a number", async () => {
    const { create } = await setup()
    const tasks = await Promise.all([create(), create(), create(), create()])
    expect(tasks.map((x) => x.number).sort()).toEqual([1, 2, 3, 4])
  })

  test("a failed create does not consume a number", async () => {
    const { owner, project, create } = await setup()
    const bad = await owner.call("POST", `/api/projects/${project.id}/tasks`, {
      title: "x",
      assigneeIds: ["not-a-member"],
    })
    expect(bad.status).toBe(400)
    expect((await create()).number).toBe(1)
  })

  test("accepts an initial status, priority, due date, body, assignees and tags", async () => {
    const { t, owner, workspaceId, project } = await setup()
    const me = await userId(t, "owner@example.com")
    const tag = await addTag(t, workspaceId, "bug")
    const res = await owner.call("POST", `/api/projects/${project.id}/tasks`, {
      title: "Full",
      status: "in_progress",
      priority: "high",
      dueAt: "2026-12-31",
      body: "Details",
      assigneeIds: [me],
      tagIds: [tag],
    })
    expect(res.body.task).toMatchObject({
      status: "in_progress",
      priority: "high",
      dueAt: "2026-12-31",
      assignees: [{ id: me, name: "owner" }],
      tags: [{ id: tag, name: "bug", color: "blue" }],
    })
    const history = await owner.call("GET", `/api/tasks/${res.body.task.id}/history`)
    expect(history.body.history[0]).toMatchObject({ fromStatus: null, toStatus: "in_progress" })
  })

  test.each([
    ["empty title", { title: "" }],
    ["bad status", { title: "x", status: "doing" }],
    ["bad priority", { title: "x", priority: "critical" }],
    ["bad date", { title: "x", dueAt: "12/31/2026" }],
    ["impossible date", { title: "x", dueAt: "2026-02-31" }],
    ["unknown parent", { title: "x", parentTaskId: "nope" }],
    ["tag from nowhere", { title: "x", tagIds: ["nope"] }],
  ])("rejects %s", async (_l, payload) => {
    const { owner, project } = await setup()
    const res = await owner.call("POST", `/api/projects/${project.id}/tasks`, payload)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })
})

describe("subtasks", () => {
  test("parent must be a top-level task in the same project", async () => {
    const { owner, workspaceId, project, create } = await setup()
    const parent = await create({ title: "Parent" })
    const child = await create({ title: "Child", parentTaskId: parent.id })

    const grandchild = await owner.call("POST", `/api/projects/${project.id}/tasks`, {
      title: "G",
      parentTaskId: child.id,
    })
    expect(grandchild.status).toBe(400)

    const other = await owner.call("POST", `/api/workspaces/${workspaceId}/projects`, {
      name: "Other",
    })
    const cross = await owner.call("POST", `/api/projects/${other.body.project.id}/tasks`, {
      title: "X",
      parentTaskId: parent.id,
    })
    expect(cross.status).toBe(400)
  })

  test("list shows top-level only; detail lists subtasks; parent shows progress counts", async () => {
    const { owner, project, create } = await setup()
    const parent = await create({ title: "Parent" })
    const c1 = await create({ title: "C1", parentTaskId: parent.id })
    await create({ title: "C2", parentTaskId: parent.id })
    await owner.call("PATCH", `/api/tasks/${c1.id}`, { status: "complete" })

    const list = await owner.call("GET", `/api/projects/${project.id}/tasks`)
    expect(list.body.tasks).toHaveLength(1)
    expect(list.body.tasks[0]).toMatchObject({
      id: parent.id,
      subtaskCount: 2,
      subtaskDoneCount: 1,
    })

    const detail = await owner.call("GET", `/api/tasks/${parent.id}`)
    expect(detail.body.task.subtasks.map((s: { title: string }) => s.title)).toEqual(["C1", "C2"])
    const child = await owner.call("GET", `/api/tasks/${c1.id}`)
    expect(child.body.task.parent).toMatchObject({ id: parent.id, title: "Parent", status: "todo" })
  })

  test("deleting a parent deletes its subtasks", async () => {
    const { owner, create } = await setup()
    const parent = await create({ title: "Parent" })
    const child = await create({ title: "Child", parentTaskId: parent.id })
    expect((await owner.call("DELETE", `/api/tasks/${parent.id}`)).status).toBe(204)
    expect((await owner.call("GET", `/api/tasks/${child.id}`)).status).toBe(404)
  })
})

describe("task list", () => {
  test("is ordered newest first", async () => {
    const { owner, project, create } = await setup()
    await create({ title: "one" })
    await create({ title: "two" })
    await create({ title: "three" })
    const list = await owner.call("GET", `/api/projects/${project.id}/tasks`)
    expect(list.body.tasks.map((x: { title: string }) => x.title)).toEqual(["three", "two", "one"])
  })
})

describe("updating tasks", () => {
  test("PATCH changes scalar fields and null clears the optional ones", async () => {
    const { owner, create } = await setup()
    const task = await create({ title: "Old", priority: "low", dueAt: "2026-01-01", body: "b" })
    const res = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      title: " New ",
      priority: "urgent",
      dueAt: "2027-02-03",
    })
    expect(res.status).toBe(200)
    expect(res.body.task).toMatchObject({ title: "New", priority: "urgent", dueAt: "2027-02-03" })

    const cleared = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      priority: null,
      dueAt: null,
      body: null,
    })
    expect(cleared.body.task).toMatchObject({ priority: null, dueAt: null })
    expect((await owner.call("GET", `/api/tasks/${task.id}`)).body.task.body).toBeNull()
  })

  test("status changes append history in order, and no-ops add nothing", async () => {
    const { owner, create } = await setup()
    const task = await create()
    await owner.call("PATCH", `/api/tasks/${task.id}`, { status: "in_progress" })
    await owner.call("PATCH", `/api/tasks/${task.id}`, { status: "in_progress", title: "Same" })
    await owner.call("PATCH", `/api/tasks/${task.id}`, { status: "complete" })

    const { history } = (await owner.call("GET", `/api/tasks/${task.id}/history`)).body
    expect(
      history.map((h: { fromStatus: string | null; toStatus: string }) => [
        h.fromStatus,
        h.toStatus,
      ]),
    ).toEqual([
      [null, "todo"],
      ["todo", "in_progress"],
      ["in_progress", "complete"],
    ])
  })

  test("a rejected PATCH changes nothing, including status and history", async () => {
    const { t, owner, create } = await setup()
    const task = await create({ title: "Keep" })
    const stranger = await signIn(t.app, "stranger@example.com")
    const strangerId = await userId(t, "stranger@example.com")
    void stranger

    const res = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      title: "Changed",
      status: "complete",
      assigneeIds: [strangerId],
    })
    expect(res.status).toBe(400)

    const after = await owner.call("GET", `/api/tasks/${task.id}`)
    expect(after.body.task).toMatchObject({ title: "Keep", status: "todo" })
    const { history } = (await owner.call("GET", `/api/tasks/${task.id}/history`)).body
    expect(history).toHaveLength(1)
  })

  test("an invalid status is rejected before anything is written", async () => {
    const { owner, create } = await setup()
    const task = await create()
    const res = await owner.call("PATCH", `/api/tasks/${task.id}`, { status: "done" })
    expect(res.status).toBe(400)
    const { history } = (await owner.call("GET", `/api/tasks/${task.id}/history`)).body
    expect(history).toHaveLength(1)
  })

  test.each([
    ["empty title", { title: "" }],
    ["blank title", { title: "  " }],
    ["bad date format", { dueAt: "tomorrow" }],
    ["impossible date", { dueAt: "2026-13-01" }],
    ["bad priority", { priority: "someday" }],
    ["unknown assignee", { assigneeIds: ["ghost"] }],
    ["unknown tag", { tagIds: ["ghost"] }],
  ])("rejects %s", async (_l, payload) => {
    const { owner, create } = await setup()
    const task = await create()
    const res = await owner.call("PATCH", `/api/tasks/${task.id}`, payload)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })

  test("assignees and tags are replaced as sets and show in summaries", async () => {
    const { t, owner, workspaceId, project, create } = await setup()
    await signIn(t.app, "second@example.com", "Bea")
    await addMember(t, workspaceId, "second@example.com")
    const me = await userId(t, "owner@example.com")
    const bea = await userId(t, "second@example.com")
    const bug = await addTag(t, workspaceId, "bug")
    const ux = await addTag(t, workspaceId, "ux")
    const task = await create()

    const set = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      assigneeIds: [me, bea, bea],
      tagIds: [ux, bug],
    })
    expect(set.body.task.assignees.map((a: { name: string }) => a.name)).toEqual(["Bea", "owner"])
    expect(set.body.task.tags.map((g: { name: string }) => g.name)).toEqual(["bug", "ux"])

    const list = await owner.call("GET", `/api/projects/${project.id}/tasks`)
    expect(list.body.tasks[0].assignees).toHaveLength(2)

    const replaced = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      assigneeIds: [bea],
      tagIds: [],
    })
    expect(replaced.body.task.assignees.map((a: { id: string }) => a.id)).toEqual([bea])
    expect(replaced.body.task.tags).toEqual([])

    const untouched = await owner.call("PATCH", `/api/tasks/${task.id}`, { title: "Renamed" })
    expect(untouched.body.task.assignees).toHaveLength(1)
  })

  test("tags from another workspace cannot be attached", async () => {
    const t = await createTestApp()
    const a = await setupProject(t, "a@example.com")
    const b = await setupProject(t, "b@example.com")
    const tag = await addTag(t, b.workspaceId, "theirs")
    const task = await a.owner.call("POST", `/api/projects/${a.project.id}/tasks`, { title: "x" })
    const res = await a.owner.call("PATCH", `/api/tasks/${task.body.task.id}`, { tagIds: [tag] })
    expect(res.status).toBe(400)
  })

  test("summaries are batched: query count does not grow with the number of tasks", async () => {
    const { t, create } = await setup()
    const ids: string[] = []
    for (let i = 0; i < 12; i++) ids.push((await create({ title: `T${i}` })).id)

    const countQueries = async (taskIds: string[]) => {
      let count = 0
      const counting = t.db.withPlugin({
        transformQuery: (args) => {
          count++
          return args.node
        },
        transformResult: async (args) => args.result,
      })
      await loadTaskSummaries(counting, taskIds)
      return count
    }
    expect(await countQueries(ids.slice(0, 2))).toBe(await countQueries(ids))
  })
})

describe("task authorization", () => {
  test("every task route is 404 for someone outside the workspace", async () => {
    const { t, create } = await setup()
    const task = await create()
    const outsider = await signIn(t.app, "out@example.com")
    const calls: [string, string, unknown?][] = [
      ["GET", `/api/tasks/${task.id}`],
      ["PATCH", `/api/tasks/${task.id}`, { title: "Hacked" }],
      ["DELETE", `/api/tasks/${task.id}`],
      ["GET", `/api/tasks/${task.id}/history`],
    ]
    for (const [method, path, body] of calls) {
      const res = await outsider.call(method, path, body)
      expect([method, path, res.status]).toEqual([method, path, 404])
      expect(res.body.code).toBe("NOT_FOUND")
    }
  })

  test("a member of the workspace can edit and delete tasks", async () => {
    const { t, workspaceId, create } = await setup()
    const task = await create()
    const member = await signIn(t.app, "m@example.com")
    await addMember(t, workspaceId, "m@example.com")
    expect((await member.call("PATCH", `/api/tasks/${task.id}`, { title: "Mine" })).status).toBe(
      200,
    )
    const history = await member.call("GET", `/api/tasks/${task.id}/history`)
    expect(history.status).toBe(200)
    expect((await member.call("DELETE", `/api/tasks/${task.id}`)).status).toBe(204)
  })

  test("unauthenticated requests are 401", async () => {
    const { t } = await setup()
    const anon = await t.app.request("/api/tasks/whatever")
    expect(anon.status).toBe(401)
  })
})
