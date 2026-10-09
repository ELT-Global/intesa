import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { removeSandboxes, startServer, type TestServer } from "./helpers"
import { lines, type TaskWorld, taskWorld } from "./task-fixtures"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

// A column, top to bottom, as the CLI lists it in board order.
const column = async (w: TaskWorld, status: string) =>
  lines((await w.box.run(["task", "list", "-p", "WEB", "-s", status, "-q"])).stdout)

const statusOf = async (w: TaskWorld, id: string) => (await w.getTask(id)).status

describe("task move: placement", () => {
  let w: TaskWorld
  let first: { id: string }
  beforeAll(async () => {
    w = await taskWorld(server)
    // New tasks go to the top: the todo column reads WEB-4, WEB-3, WEB-2, WEB-1.
    first = await w.addTask({ title: "One" })
    for (const title of ["Two", "Three", "Four"]) await w.addTask({ title })
  })

  test("--top, --bottom, --before and --after within a column", async () => {
    expect(await column(w, "todo")).toEqual(["WEB-4", "WEB-3", "WEB-2", "WEB-1"])
    expect((await w.box.run(["task", "move", "WEB-1", "todo", "--top"])).exitCode).toBe(0)
    expect(await column(w, "todo")).toEqual(["WEB-1", "WEB-4", "WEB-3", "WEB-2"])
    await w.box.run(["task", "move", "web-4", "todo", "--bottom"])
    expect(await column(w, "todo")).toEqual(["WEB-1", "WEB-3", "WEB-2", "WEB-4"])
    await w.box.run(["task", "move", "WEB-4", "todo", "--before", "WEB-3"])
    expect(await column(w, "todo")).toEqual(["WEB-1", "WEB-4", "WEB-3", "WEB-2"])
    await w.box.run(["task", "move", "WEB-1", "todo", "--after", "web-2"])
    expect(await column(w, "todo")).toEqual(["WEB-4", "WEB-3", "WEB-2", "WEB-1"])
  })

  test("across columns: the top by default, or where asked", async () => {
    const r = await w.box.run(["task", "move", "WEB-2", "review", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ key: "WEB-2", status: "review", subtasksOutOfSync: [] })
    await w.box.run(["task", "move", "WEB-3", "review", "--bottom"])
    await w.box.run(["task", "move", "WEB-4", "review", "--after", "WEB-2"])
    expect(await column(w, "review")).toEqual(["WEB-2", "WEB-4", "WEB-3"])
    expect(await column(w, "todo")).toEqual(["WEB-1"])
  })

  test("an anchor outside the target column is rejected by the server (exit 8)", async () => {
    const r = await w.box.run(["task", "move", "WEB-1", "backlog", "--before", "WEB-2"])
    expect(r.exitCode).toBe(8)
    expect(await statusOf(w, first.id)).toBe("todo")
  })

  test("usage errors: two placements, an unknown status", async () => {
    expect((await w.box.run(["task", "move", "WEB-1", "todo", "--top", "--bottom"])).exitCode).toBe(
      2,
    )
    const r = await w.box.run(["task", "move", "WEB-1", "doing"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("in_progress")
  })
})

describe("task move: subtasks", () => {
  // A parent with one todo and one complete subtask.
  async function family() {
    const w = await taskWorld(server)
    const parent = await w.addTask({ title: "Parent" })
    const todo = await w.addTask({ title: "Kid todo", parentTaskId: parent.id })
    const done = await w.addTask({ title: "Kid done", parentTaskId: parent.id, status: "complete" })
    return { w, parent, todo, done }
  }

  test("keep (the default without a terminal) changes nothing and reports the differences", async () => {
    const { w, parent, todo, done } = await family()
    const r = await w.box.run(["task", "move", parent.key, "in_progress", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json().subtasksOutOfSync).toEqual([
      { key: todo.key, status: "todo" },
      { key: done.key, status: "complete" },
    ])
    expect(await statusOf(w, todo.id)).toBe("todo")
    expect(await statusOf(w, done.id)).toBe("complete")
  })

  test("match sets the differing subtasks to the parent's new status", async () => {
    const { w, parent, todo, done } = await family()
    const r = await w.box.run([
      "task",
      "move",
      parent.key,
      "review",
      "--subtasks",
      "match",
      "--json",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.json().subtasksOutOfSync).toEqual([])
    expect(await statusOf(w, todo.id)).toBe("review")
    expect(await statusOf(w, done.id)).toBe("review")
  })

  test("a status sets every subtask to it", async () => {
    const { w, parent, todo, done } = await family()
    const r = await w.box.run([
      "task",
      "move",
      parent.key,
      "review",
      "--subtasks",
      "complete",
      "--json",
    ])
    expect(await statusOf(w, parent.id)).toBe("review")
    expect(await statusOf(w, todo.id)).toBe("complete")
    expect(await statusOf(w, done.id)).toBe("complete")
    expect(r.json().subtasksOutOfSync).toEqual([
      { key: todo.key, status: "complete" },
      { key: done.key, status: "complete" },
    ])
  })

  test("--dry-run prints the parent's PATCH only and sends nothing", async () => {
    const { w, parent, todo } = await family()
    const r = await w.box.run([
      "task",
      "move",
      parent.key,
      "complete",
      "--subtasks",
      "match",
      "--dry-run",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({
      method: "PATCH",
      path: `/api/tasks/${parent.id}`,
      body: { status: "complete" },
    })
    expect(await statusOf(w, parent.id)).toBe("todo")
    expect(await statusOf(w, todo.id)).toBe("todo")
  })

  test("done takes --subtasks too", async () => {
    const { w, parent, todo } = await family()
    expect((await w.box.run(["task", "done", parent.key, "--subtasks", "match"])).exitCode).toBe(0)
    expect(await statusOf(w, parent.id)).toBe("complete")
    expect(await statusOf(w, todo.id)).toBe("complete")
  })
})

describe("task start, review, done", () => {
  test("move to in progress, review and complete", async () => {
    const w = await taskWorld(server)
    const task = await w.addTask({ title: "Flow" })
    const start = await w.box.run(["task", "start", task.key, "--json"])
    expect(start.json()).toMatchObject({ key: task.key, status: "in_progress" })
    await w.box.run(["task", "review", task.key])
    expect(await statusOf(w, task.id)).toBe("review")
    await w.box.run(["task", "done", task.key])
    expect(await statusOf(w, task.id)).toBe("complete")
  })
})

describe("task assign, unassign", () => {
  test("@me by default; names add to or remove from the current assignees", async () => {
    const w = await taskWorld(server)
    await w.addPerson("Mei Member")
    const task = await w.addTask({ title: "Who" })
    const names = async () =>
      (await w.getTask(task.id)).assignees.map((a: { name: string }) => a.name)

    const r = await w.box.run(["task", "assign", task.key, "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json().assignees.map((a: { name: string }) => a.name)).toEqual(["Alan Owner"])
    await w.box.run(["task", "assign", task.key, "Mei Member"])
    expect(await names()).toEqual(["Alan Owner", "Mei Member"])
    await w.box.run(["task", "unassign", task.key])
    expect(await names()).toEqual(["Mei Member"])
    await w.box.run(["task", "assign", task.key, "@me", "mei member"])
    expect(await names()).toEqual(["Alan Owner", "Mei Member"])
    await w.box.run(["task", "unassign", task.key, "@me", "Mei Member"])
    expect(await names()).toEqual([])
  })

  test("an unknown person exits 5 and changes nothing", async () => {
    const w = await taskWorld(server)
    const task = await w.addTask({ title: "Who", assigneeIds: [w.me] })
    expect((await w.box.run(["task", "assign", task.key, "Nobody"])).exitCode).toBe(5)
    expect((await w.getTask(task.id)).assignees).toHaveLength(1)
  })
})

describe("task delete", () => {
  test("needs --yes without a terminal and warns that subtasks go too", async () => {
    const w = await taskWorld(server)
    const parent = await w.addTask({ title: "Parent" })
    const kid = await w.addTask({ title: "Kid", parentTaskId: parent.id })
    await w.addTask({ title: "Kid 2", parentTaskId: parent.id })

    const refused = await w.box.run(["task", "delete", parent.key])
    expect(refused.exitCode).toBe(2)
    expect(refused.stderr).toContain("--yes")
    expect(refused.stderr).toContain("2 subtasks")
    expect(await w.getTask(parent.id)).toBeDefined()

    const r = await w.box.run(["task", "delete", parent.key, "--yes"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect(r.stderr).toContain("2 subtasks")
    expect((await w.box.run(["task", "view", parent.key])).exitCode).toBe(5)
    expect(await w.getTask(kid.id)).toBeUndefined()
  })

  test("--json reports what was deleted", async () => {
    const w = await taskWorld(server)
    const task = await w.addTask({ title: "Gone" })
    const r = await w.box.run(["task", "delete", task.key, "--yes", "--json"])
    expect(r.json()).toEqual({ id: task.id, key: task.key, deleted: true })
  })
})
