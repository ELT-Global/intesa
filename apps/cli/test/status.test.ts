import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { dayFromToday } from "@intesa/task-query"
import { userId } from "../../api/test/helpers"
import { loginAs, removeSandboxes, sandbox, startServer, type TestServer } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

describe("intesa status", () => {
  test("shows recent projects, tasks assigned to me and tasks due soon", async () => {
    const box = sandbox(server.url)
    const email = "home@example.com"
    const { session } = await loginAs(box, server, email)
    const ws = (await session.call("POST", "/api/workspaces", { name: "Home", slug: "home-ws" }))
      .body.workspace
    const project = (
      await session.call("POST", `/api/workspaces/${ws.id}/projects`, {
        name: "Website",
        key: "WEB",
        description: "Marketing site",
      })
    ).body.project
    const me = await userId(server, email)
    const tasks = `/api/projects/${project.id}/tasks`
    const mine = (await session.call("POST", tasks, { title: "Mine", assigneeIds: [me] })).body.task
    const due = (await session.call("POST", tasks, { title: "Due", dueAt: dayFromToday(2) })).body
      .task
    await session.call("POST", tasks, { title: "Neither" })

    const r = await box.run(["status", "--json"])
    expect(r.exitCode).toBe(0)
    const status = r.json()
    expect(status.projects).toEqual([
      expect.objectContaining({
        key: "WEB",
        name: "Website",
        url: `${server.url}/w/home-ws/projects/${project.id}`,
      }),
    ])
    expect(status.assigned).toEqual([
      expect.objectContaining({
        key: mine.key,
        title: "Mine",
        url: `${server.url}/w/home-ws/projects/${project.id}?task=${mine.id}`,
      }),
    ])
    expect(status.dueSoon.map((t: { key: string }) => t.key)).toEqual([due.key])

    const text = await box.run(["status"])
    expect(text.exitCode).toBe(0)
    expect(text.stdout).toContain("Recent projects")
    expect(text.stdout).toContain("Assigned to you")
    expect(text.stdout).toContain("Due soon")
    expect(text.stdout).toContain("Website")
    expect(text.stdout).toContain(`${mine.key}\t`)
    expect(text.stdout).toContain(due.key)

    const narrowed = await box.run(["status", "--json", "--fields", "assigned"])
    expect(Object.keys(narrowed.json())).toEqual(["assigned"])
  })

  test("empty sections say so", async () => {
    const box = sandbox(server.url)
    const { session } = await loginAs(box, server, "empty-home@example.com")
    await session.call("POST", "/api/workspaces", { name: "Empty", slug: "empty-ws" })
    const r = await box.run(["status"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Nothing assigned to you")
  })

  test("logged out, exits 4", async () => {
    expect((await sandbox(server.url).run(["status"])).exitCode).toBe(4)
  })
})
