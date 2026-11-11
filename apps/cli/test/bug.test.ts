import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { fakeServer, removeSandboxes, startServer, type TestServer, world } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

type Listed = {
  id: string
  url: string
  key: string
  title: string
  status: string
  tasks: { key: string; status: string }[]
}

// A signed-in sandbox whose user owns one workspace with a project WEB and a `bug` tag.
async function setup(opts: { scope?: "read" | "write" } = {}) {
  const w = await world(server, opts)
  const bugTag = await w.addTag("bug")
  // A task tagged bug opens a bug with its title.
  const addBug = async (title: string, body?: string) => {
    const task = await w.addTask({ title, body, tagIds: [bugTag.id] })
    return { task, bug: (await w.getTask(task.id)).bug as { id: string; key: string } }
  }
  const complete = (taskId: string) =>
    w.patchTask(taskId, { status: "complete", reviewedById: null, testedById: null })
  const bugUrl = (bugId: string) =>
    `${server.url}/w/${w.workspace.slug}/projects/${w.project.id}/bugs?bug=${bugId}`
  return { ...w, bugTag, addBug, complete, bugUrl }
}

describe("bug list", () => {
  test("lists the project's bugs, pending first; --status filters", async () => {
    const { box, addBug, complete, bugUrl } = await setup()
    const first = await addBug("Login fails")
    await addBug("Crash on save")
    await complete(first.task.id)

    const all = await box.run(["bug", "list", "-p", "WEB", "--json"])
    expect(all.exitCode).toBe(0)
    expect((all.json() as Listed[]).map((b) => [b.key, b.status])).toEqual([
      ["WEB-B2", "pending"],
      ["WEB-B1", "resolved"],
    ])
    expect((all.json() as Listed[])[1]?.tasks.map((t) => t.key)).toEqual([first.task.key])
    expect((all.json() as Listed[])[1]?.url).toBe(bugUrl(first.bug.id))

    const pending = await box.run(["b", "ls", "-p", "WEB", "--status", "pending", "-q"])
    expect(pending.stdout).toBe("WEB-B2\n")
    const resolved = await box.run(["bug", "list", "-p", "WEB", "--status", "resolved"])
    expect(resolved.stdout).toBe("WEB-B1\tresolved\tLogin fails\n")
    const fixed = await box.run(["bug", "view", "WEB-B1", "--json", "--fields", "fixedAt"])
    const view = await box.run(["bug", "view", "WEB-B1"])
    expect(view.stdout).toContain(`Fixed\t${fixed.json().fixedAt}`)
  })

  test("a project without bugs prints nothing; a bad status is a usage error", async () => {
    const { box } = await setup()
    const none = await box.run(["bug", "list", "-p", "WEB"])
    expect(none.exitCode).toBe(0)
    expect(none.stdout).toBe("")
    const bad = await box.run(["bug", "list", "-p", "WEB", "--status", "open"])
    expect(bad.exitCode).toBe(2)
    expect(bad.stderr).toContain("--status")
  })

  test("needs a project", async () => {
    const { box } = await setup()
    expect((await box.run(["bug", "list"])).exitCode).toBe(2)
  })
})

describe("bug view", () => {
  test("finds a bug by key in any case or by id and shows it with its tasks", async () => {
    const { box, addBug, bugUrl } = await setup()
    const { task, bug } = await addBug("Login fails", "Steps to reproduce")

    const byKey = await box.run(["bug", "view", "web-b1", "--json"])
    expect(byKey.exitCode).toBe(0)
    expect(byKey.json()).toMatchObject({
      id: bug.id,
      key: "WEB-B1",
      title: "Login fails",
      // The bug's own description starts empty; the task's is its own.
      body: null,
      url: bugUrl(bug.id),
      status: "pending",
      tasks: [{ key: task.key, status: "todo", body: "Steps to reproduce" }],
    })
    expect((await box.run(["bug", "view", bug.id, "--json"])).json().key).toBe("WEB-B1")
    expect((await box.run(["bug", "view", "B1", "-p", "WEB", "--json"])).json().key).toBe("WEB-B1")

    const text = await box.run(["b", "view", "WEB-B1"])
    expect(text.stdout).toContain("WEB-B1  Login fails")
    expect(text.stdout).toContain(bugUrl(bug.id))
    expect(text.stdout).not.toContain("Follows")
    expect(text.stdout).toContain("Tasks (1)")
    expect(text.stdout).toContain(`${task.key}\tTodo\tLogin fails`)
    expect(text.stdout).toContain(`Raised\t${byKey.json().createdAt}`)
    expect(text.stdout).toContain("Fixed\t—")
    expect(text.stdout).toContain("Regressions\t0")
  })

  test("--fields selects, and unknown or malformed bugs fail", async () => {
    const { box, addBug } = await setup()
    await addBug("Only")
    const r = await box.run(["bug", "view", "WEB-B1", "--json", "--fields", "key,status"])
    expect(r.json()).toEqual({ key: "WEB-B1", status: "pending" })
    expect((await box.run(["bug", "view", "WEB-B9"])).exitCode).toBe(5)
    const bad = await box.run(["bug", "view", "nonsense"])
    expect(bad.exitCode).toBe(2)
    expect(bad.stderr).toContain("WEB-B3")
    expect((await box.run(["bug", "view", "B1"])).exitCode).toBe(2)
  })
})

describe("bug edit", () => {
  test("changes the bug's title and body, never its task's", async () => {
    const { box, addBug, getTask } = await setup()
    const { task } = await addBug("Login fails", "old")
    const r = await box.run([
      "bug",
      "edit",
      "WEB-B1",
      "-T",
      "SSO login fails",
      "-b",
      "new",
      "--json",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({
      title: "SSO login fails",
      body: "new",
      tasks: [{ key: task.key, title: "Login fails", body: "old" }],
    })
    expect(await getTask(task.id)).toMatchObject({ title: "Login fails", body: "old" })
  })

  test("--body-file reads the description from a file or stdin", async () => {
    const { box, addBug } = await setup()
    await addBug("Bug")
    writeFileSync(join(box.root, "work", "steps.md"), "# Steps\n")
    const fromFile = await box.run(["bug", "edit", "WEB-B1", "-F", "steps.md", "--json"])
    expect(fromFile.json().body).toBe("# Steps\n")
    const fromStdin = await box.run(["bug", "edit", "WEB-B1", "-F", "-", "--json"], {
      stdin: "piped\n",
    })
    expect(fromStdin.json().body).toBe("piped\n")
  })

  test("nothing to change and both body flags are usage errors", async () => {
    const { box, addBug } = await setup()
    await addBug("Bug")
    const none = await box.run(["bug", "edit", "WEB-B1"])
    expect(none.exitCode).toBe(2)
    expect(none.stderr).toContain("--title")
    const both = await box.run(["bug", "edit", "WEB-B1", "-b", "x", "-F", "y"])
    expect(both.exitCode).toBe(2)
  })

  test("a read-only token cannot edit or reopen (exit 7)", async () => {
    const { box, addBug, complete } = await setup({ scope: "read" })
    const { task } = await addBug("Bug")
    expect((await box.run(["bug", "edit", "WEB-B1", "-T", "x"])).exitCode).toBe(7)
    await complete(task.id)
    expect((await box.run(["bug", "reopen", "WEB-B1"])).exitCode).toBe(7)
  })
})

describe("bug reopen", () => {
  test("opens a regression task for a resolved bug, titled like the bug", async () => {
    const { box, addBug, complete, getTask } = await setup()
    const { task, bug } = await addBug("Login fails")
    await complete(task.id)

    const r = await box.run(["bug", "reopen", "WEB-B1", "--json"])
    expect(r.exitCode, r.stderr).toBe(0)
    const out = r.json()
    expect(out).toMatchObject({ title: "Login fails", status: "todo", bug: { key: "WEB-B1" } })
    expect(out.bug.status).toBe("pending")
    expect(out.bug.tasks.map((t: { key: string }) => t.key)).toEqual([task.key, out.key])
    expect((await getTask(out.id)).bug).toMatchObject({ id: bug.id, status: "pending" })
    expect(r.stderr).toContain(`Opened ${out.key} for WEB-B1`)

    // A bug that came back says so, with its count of regression tasks.
    const list = await box.run(["bug", "list", "-p", "WEB"])
    expect(list.stdout).toBe("WEB-B1\tregressed (1)\tLogin fails\n")
    const json = (await box.run(["bug", "view", "WEB-B1", "--json"])).json()
    expect(json).toMatchObject({ status: "pending", regressions: 1, fixedAt: null })
    expect(json.tasks[0].completedAt).toEqual(expect.any(String))
    const text = await box.run(["bug", "view", "WEB-B1"])
    expect(text.stdout).toContain("Status\tregressed (1)")
    expect(text.stdout).toContain("Regressions\t1")
  })

  test("takes the task-create options", async () => {
    const { box, addBug, complete, addPerson, me } = await setup()
    const mei = await addPerson("Mei Member")
    const { task } = await addBug("Login fails")
    await complete(task.id)
    const r = await box.run([
      "bug",
      "reopen",
      "WEB-B1",
      "-T",
      "Fails again",
      "-b",
      "Regression",
      "--priority",
      "high",
      "--due",
      "2030-01-02",
      "-a",
      "Mei Member",
      "-a",
      "@me",
      "-t",
      "web",
      "--create-tags",
      "--json",
    ])
    expect(r.exitCode, r.stderr).toBe(0)
    expect(r.json()).toMatchObject({
      title: "Fails again",
      body: "Regression",
      priority: "high",
      dueAt: "2030-01-02",
    })
    const assignees = r.json().assignees.map((a: { id: string }) => a.id)
    expect(assignees.sort()).toEqual([mei.id, me].sort())
    const tags = r.json().tags.map((t: { name: string }) => t.name)
    expect(tags.sort()).toEqual(["bug", "web"])
  })

  test("a pending bug exits 6 naming its open task, and creates nothing", async () => {
    const { box, addBug, projectTasks } = await setup()
    const { task } = await addBug("Login fails")
    const r = await box.run(["bug", "reopen", "WEB-B1"])
    expect(r.exitCode).toBe(6)
    expect(r.stderr).toContain("WEB-B1 is still pending")
    expect(r.stderr).toContain(task.key)
    expect(await projectTasks()).toHaveLength(1)
    const json = await box.run(["bug", "reopen", "WEB-B1", "--json"])
    expect(json.exitCode).toBe(6)
    expect(JSON.parse(json.stderr).error.code).toBe("CONFLICT")
  })

  test("a task opened between the check and the request exits 6 naming it", async () => {
    const { box, addBug, complete, token, projectTasks } = await setup()
    const { task, bug } = await addBug("Login fails")
    await complete(task.id)
    // Lets the CLI see the bug resolved, then opens a task for it just before the CLI's POST,
    // so the server answers that POST with 409.
    const proxy = fakeServer(async (req) => {
      const { pathname, search } = new URL(req.url)
      const forward = async () =>
        fetch(`${server.url}${pathname}${search}`, {
          method: req.method,
          headers: req.headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.clone().arrayBuffer(),
        })
      if (req.method === "POST" && pathname === `/api/bugs/${bug.id}/tasks`) {
        expect((await forward()).status).toBe(201)
      }
      return forward()
    })
    try {
      const r = await box.run(["bug", "reopen", "WEB-B1"], {
        env: { INTESA_HOST: proxy.url, INTESA_TOKEN: token },
      })
      expect(r.exitCode, r.stderr).toBe(6)
      const tasks = await projectTasks()
      expect(tasks).toHaveLength(2)
      const opened = tasks.find((t) => t.id !== task.id)
      expect(r.stderr).toContain(`WEB-B1 is still pending: complete ${opened?.key} (Todo)`)
    } finally {
      proxy.stop()
    }
  })

  test("a bad due date is refused before anything is sent", async () => {
    const { box, addBug, complete, projectTasks } = await setup()
    const { task } = await addBug("Bug")
    await complete(task.id)
    const r = await box.run(["bug", "reopen", "WEB-B1", "--due", "soon"])
    expect(r.exitCode).toBe(2)
    expect(await projectTasks()).toHaveLength(1)
  })
})

describe("task view", () => {
  test("shows the task's bug with its link, and --json carries it", async () => {
    const { box, addBug, addTask, bugUrl } = await setup()
    const { task, bug } = await addBug("Login fails")
    const text = await box.run(["task", "view", task.key])
    expect(text.stdout).toContain(`Bug\tWEB-B1  Login fails (pending)  ${bugUrl(bug.id)}`)
    const json = await box.run(["task", "view", task.key, "--json"])
    expect(json.json().bug).toMatchObject({ key: "WEB-B1", status: "pending", url: bugUrl(bug.id) })

    const plain = await addTask({ title: "Plain" })
    const view = await box.run(["task", "view", plain.key])
    expect(view.stdout).not.toContain("Bug")
  })
})
