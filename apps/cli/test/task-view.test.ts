import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { keysOf, removeSandboxes, startServer, type TestServer, type World, world } from "./helpers"

let server: TestServer
let w: World
// biome-ignore lint/suspicious/noExplicitAny: API response shapes
let parent: any
let estimateId: string

beforeAll(async () => {
  server = await startServer()
  w = await world(server)
  const auth = await w.addTag("auth")
  parent = await w.addTask({
    title: "Plan the launch",
    body: "# Plan\n\nUse **bold** words.\n",
    priority: "high",
    dueAt: "2030-03-04",
    assigneeIds: [w.me],
    tagIds: [auth.id],
  })
  await w.addTask({ title: "First step", parentTaskId: parent.id })
  await w.addTask({ title: "Second step", parentTaskId: parent.id, status: "complete" })
  const blocked = await w.addTask({ title: "Blocked work" })
  await w.session.call("POST", `/api/tasks/${parent.id}/relationships`, {
    type: "blocks",
    taskId: blocked.id,
  })
  estimateId = (await w.addField({ name: "Estimate", type: "number" })).id
  await w.patchTask(parent.id, { customFields: { [estimateId]: 3 }, status: "in_progress" })
  const form = new FormData()
  form.append("file", new File(["# Notes\n"], "notes.md", { type: "text/markdown" }))
  const upload = await w.session.request(`/api/tasks/${parent.id}/artifacts`, {
    method: "POST",
    body: form,
  })
  if (upload.status !== 201) throw new Error(`upload failed: ${upload.status}`)
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

describe("task view --json", () => {
  test("the task detail with its key, link, subtasks, relationships and artifacts", async () => {
    const r = await w.box.run(["task", "view", "WEB-1", "--json"])
    expect(r.exitCode).toBe(0)
    const task = r.json()
    expect(task).toMatchObject({
      id: parent.id,
      key: "WEB-1",
      title: "Plan the launch",
      status: "in_progress",
      priority: "high",
      dueAt: "2030-03-04",
      body: "# Plan\n\nUse **bold** words.\n",
      project: { key: "WEB" },
      customFields: { [estimateId]: 3 },
      subtaskCount: 2,
      subtaskDoneCount: 1,
    })
    expect(task.url).toBe(
      `${server.url}/w/${w.workspace.slug}/projects/${w.project.id}?task=${parent.id}`,
    )
    expect(keysOf(task.subtasks)).toEqual(["WEB-2", "WEB-3"])
    expect(keysOf(task.blocks)).toEqual(["WEB-4"])
    expect(task.blockedBy).toEqual([])
    expect(task.artifacts).toEqual([expect.objectContaining({ name: "notes.md" })])
  })

  test("--fields narrows it", async () => {
    const r = await w.box.run(["task", "view", "WEB-1", "--json", "--fields", "key,status"])
    expect(r.json()).toEqual({ key: "WEB-1", status: "in_progress" })
  })

  test("--history adds the status history", async () => {
    const r = await w.box.run(["task", "view", "WEB-1", "--history", "--json"])
    const statuses = r.json().history.map((h: { toStatus: string }) => h.toStatus)
    expect(statuses).toEqual(["todo", "in_progress"])
  })
})

describe("task view", () => {
  test("piped: properties, the markdown source, subtasks, links, fields and artifacts", async () => {
    const r = await w.box.run(["task", "view", "WEB-1"])
    expect(r.exitCode).toBe(0)
    for (const text of [
      "WEB-1",
      "Plan the launch",
      "In progress",
      "High",
      "Alan Owner",
      "auth",
      "2030-03-04",
      "# Plan",
      "Use **bold** words.",
      "WEB-2",
      "First step",
      "WEB-3",
      "Blocks",
      "WEB-4",
      "Estimate",
      "notes.md",
    ]) {
      expect(r.stdout).toContain(text)
    }
    expect(r.stdout).toContain(`?task=${parent.id}`)
  })

  test("a terminal gets rendered markdown; --raw keeps the source", async () => {
    const env = { INTESA_FORCE_TTY: "100" }
    const rendered = await w.box.run(["task", "view", "WEB-1"], { env })
    expect(rendered.exitCode).toBe(0)
    expect(rendered.stdout).toContain("bold")
    expect(rendered.stdout).not.toContain("**bold**")
    const raw = await w.box.run(["task", "view", "WEB-1", "--raw"], { env })
    expect(raw.stdout).toContain("Use **bold** words.")
  })

  test("--history lists the status changes", async () => {
    const r = await w.box.run(["task", "view", "WEB-1", "--history"])
    expect(r.stdout).toContain("History")
    expect(r.stdout).toMatch(/Todo.*In progress/)
  })

  test("--web opens the task's link and prints it", async () => {
    const r = await w.box.run(["task", "view", "WEB-1", "--web"], {
      env: { BROWSER: "intesa-test-no-such-browser" },
    })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect(r.stderr).toContain(`?task=${parent.id}`)
  })
})

describe("task references", () => {
  test("a key in any case, a number with -p, a UUID or a web link", async () => {
    const link = `${server.url}/w/${w.workspace.slug}/projects/${w.project.id}?task=${parent.id}`
    for (const args of [["web-1"], ["1", "-p", "web"], [parent.id], [link]]) {
      const r = await w.box.run(["task", "view", ...args, "--json", "--fields", "id"])
      expect(r.exitCode, args.join(" ")).toBe(0)
      expect(r.json().id).toBe(parent.id)
    }
  })

  test("a task in another workspace links to that workspace, with no workspace chosen", async () => {
    const two = await world(server)
    const elsewhere = (
      await two.session.call("POST", "/api/workspaces", { name: "Beta", slug: `beta-${two.id}` })
    ).body.workspace
    const project = (
      await two.session.call("POST", `/api/workspaces/${elsewhere.id}/projects`, {
        name: "Api",
        key: "API",
      })
    ).body.project
    const task = await two.addTask({ title: "Over there" }, project.id)
    const expected = `${server.url}/w/${elsewhere.slug}/projects/${project.id}?task=${task.id}`
    // Two workspaces and no default: only the task's own workspace can be meant.
    for (const args of [[task.id], [task.id, "-w", two.workspace.slug]]) {
      const r = await two.box.run(["task", "view", ...args, "--json", "--fields", "url"])
      expect(r.exitCode, args.join(" ")).toBe(0)
      expect(r.json().url).toBe(expected)
    }
  })

  test("an unknown task exits 5; nonsense exits 2", async () => {
    expect((await w.box.run(["task", "view", "WEB-99"])).exitCode).toBe(5)
    expect((await w.box.run(["task", "view", "what"])).exitCode).toBe(2)
  })

  test("task keys of the current project complete", async () => {
    const r = await w.box.run(["__complete", "--word=WEB-", "--", "task", "view", "-p", "WEB"])
    expect(r.stdout.split("\n").filter(Boolean)).toEqual(["WEB-1", "WEB-4"])
    const status = await w.box.run(["__complete", "--word=in", "--", "task", "move", "WEB-1"])
    expect(status.stdout).toBe("in_progress\n")
  })
})
