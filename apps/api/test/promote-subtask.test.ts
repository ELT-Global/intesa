import { describe, expect, test } from "bun:test"
import { addMember, createTestApp, setupProject, signIn } from "./helpers"

async function setup() {
  const t = await createTestApp()
  const ctx = await setupProject(t, "owner@example.com")
  const create = async (body: Record<string, unknown>) => {
    const res = await ctx.owner.call("POST", `/api/projects/${ctx.project.id}/tasks`, body)
    expect(res.status).toBe(201)
    return res.body.task as { id: string; key: string }
  }
  const promote = (taskId: string, assigneeIds: string[], as = ctx.owner) =>
    as.call("POST", `/api/tasks/${taskId}/promote`, { assigneeIds })
  const board = async () =>
    (await ctx.owner.call("GET", `/api/projects/${ctx.project.id}/tasks`)).body.tasks as {
      id: string
      status: string
    }[]
  return { t, ...ctx, create, promote, board }
}

describe("promoting a subtask", () => {
  test("it joins the board at the top of its status column, with the chosen assignee", async () => {
    const { t, workspaceId, owner, create, promote, board } = await setup()
    await signIn(t.app, "m@example.com", "Mia")
    const mia = await addMember(t, workspaceId, "m@example.com")
    const parent = await create({ title: "Parent", status: "in_progress" })
    const other = await create({ title: "Other", status: "in_progress" })
    const child = await create({ title: "Child", parentTaskId: parent.id, status: "in_progress" })
    await create({ title: "Sibling", parentTaskId: parent.id })

    const res = await promote(child.id, [mia])
    expect(res.status).toBe(200)
    expect(res.body.task).toMatchObject({
      id: child.id,
      key: child.key,
      parentTaskId: null,
      parent: null,
      status: "in_progress",
      assignees: [{ id: mia, name: "Mia" }],
    })

    const inProgress = (await board()).filter((x) => x.status === "in_progress").map((x) => x.id)
    expect(inProgress).toEqual([child.id, other.id, parent.id])

    const after = await owner.call("GET", `/api/tasks/${parent.id}`)
    expect(after.body.task).toMatchObject({ subtaskCount: 1, subtaskDoneCount: 0 })
    expect(after.body.task.subtasks.map((s: { title: string }) => s.title)).toEqual(["Sibling"])

    // The status did not change, so the history still has only the creation row.
    const history = await owner.call("GET", `/api/tasks/${child.id}/history`)
    expect(history.body.history).toHaveLength(1)
  })

  test("a completed subtask stays complete and leaves the parent's done count", async () => {
    const { owner, create, promote, board } = await setup()
    const parent = await create({ title: "Parent" })
    const child = await create({ title: "Done step", parentTaskId: parent.id })
    await owner.call("PATCH", `/api/tasks/${child.id}`, { status: "complete" })

    const res = await promote(child.id, [])
    expect(res.status).toBe(200)
    expect(res.body.task).toMatchObject({ status: "complete", assignees: [] })
    expect((await board()).find((x) => x.id === child.id)?.status).toBe("complete")
    const after = await owner.call("GET", `/api/tasks/${parent.id}`)
    expect(after.body.task).toMatchObject({ subtaskCount: 0, subtaskDoneCount: 0 })
  })

  test("the assignees are replaced by the chosen set", async () => {
    const { t, workspaceId, create, promote } = await setup()
    await signIn(t.app, "a@example.com", "Ann")
    await signIn(t.app, "b@example.com", "Ben")
    const ann = await addMember(t, workspaceId, "a@example.com")
    const ben = await addMember(t, workspaceId, "b@example.com")
    const parent = await create({ title: "Parent" })
    const child = await create({ title: "Child", parentTaskId: parent.id, assigneeIds: [ann] })

    const res = await promote(child.id, [ben])
    expect(res.body.task.assignees.map((a: { id: string }) => a.id)).toEqual([ben])
  })

  test("refuses a top-level task and an assignee outside the workspace, changing nothing", async () => {
    const { owner, create, promote } = await setup()
    const parent = await create({ title: "Parent" })
    const child = await create({ title: "Child", parentTaskId: parent.id })

    const topLevel = await promote(parent.id, [])
    expect(topLevel.status).toBe(400)
    expect(topLevel.body.code).toBe("VALIDATION_ERROR")

    const stranger = await promote(child.id, ["not-a-member"])
    expect(stranger.status).toBe(400)
    const still = await owner.call("GET", `/api/tasks/${child.id}`)
    expect(still.body.task.parentTaskId).toBe(parent.id)

    // Promoting twice: the second call finds a top-level task.
    expect((await promote(child.id, [])).status).toBe(200)
    expect((await promote(child.id, [])).status).toBe(400)
  })

  test("is 404 for someone outside the workspace", async () => {
    const { t, create, promote } = await setup()
    const parent = await create({ title: "Parent" })
    const child = await create({ title: "Child", parentTaskId: parent.id })
    const outsider = await signIn(t.app, "out@example.com")
    const res = await promote(child.id, [], outsider)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe("NOT_FOUND")
  })
})
