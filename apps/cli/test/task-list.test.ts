import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { dayFromToday, TASK_STATUSES } from "@intesa/task-query"
import {
  keysOf,
  lines,
  removeSandboxes,
  startServer,
  type TestServer,
  type World,
  world,
} from "./helpers"

let server: TestServer
let w: World
let mei: { id: string; name: string; email: string }
const tomorrow = dayFromToday(1)
const yesterday = dayFromToday(-1)

// WEB: one top-level task per column plus a completed one and a subtask; API: two of mine.
beforeAll(async () => {
  server = await startServer()
  w = await world(server)
  mei = await w.addPerson("Mei Member")
  const auth = await w.addTag("auth")
  const bug = await w.addTag("bug")
  const login = await w.addTask({
    title: "Login redirect",
    status: "todo",
    priority: "high",
    dueAt: tomorrow,
    assigneeIds: [w.me],
    tagIds: [auth.id],
  })
  const signup = await w.addTask({
    title: "Signup copy",
    status: "in_progress",
    dueAt: yesterday,
    assigneeIds: [mei.id],
    tagIds: [bug.id],
    body: "Mentions **oauth** somewhere",
  })
  await w.addTask({ title: "Done thing", status: "complete", assigneeIds: [w.me] })
  await w.addTask({ title: "Backlog idea", status: "backlog", priority: "low" })
  await w.addTask({
    title: "Review me",
    status: "review",
    priority: "urgent",
    dueAt: "2030-01-15",
    assigneeIds: [w.me, mei.id],
  })
  await w.addTask({ title: "Child", parentTaskId: login.id, assigneeIds: [w.me] })
  const api = await w.addProject("Api", "API")
  await w.addTask({ title: "Api work", status: "in_progress", assigneeIds: [w.me] }, api.id)
  await w.addTask({ title: "Api done", status: "complete", assigneeIds: [w.me] }, api.id)
  // The most recently updated task, for --sort updated.
  await w.patchTask(signup.id, { body: "Mentions **oauth** somewhere" })
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

const list = async (...args: string[]) => {
  const r = await w.box.run(["task", "list", ...args, "--json"])
  if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${r.stderr}`)
  return keysOf(r.json())
}

describe("task list", () => {
  test("top-level open tasks of the project in board order", async () => {
    expect(await list("-p", "WEB")).toEqual(["WEB-4", "WEB-1", "WEB-2", "WEB-5"])
  })

  test("completed tasks only with --include-complete or an explicit status", async () => {
    expect(await list("-p", "web", "--include-complete")).toEqual([
      "WEB-4",
      "WEB-1",
      "WEB-2",
      "WEB-5",
      "WEB-3",
    ])
    expect(await list("-p", "WEB", "-s", "complete")).toEqual(["WEB-3"])
    expect(await list("-p", "WEB", "-Q", "status:complete")).toEqual(["WEB-3"])
  })

  test("--status takes several values", async () => {
    expect(await list("-p", "WEB", "-s", "todo,in_progress")).toEqual(["WEB-1", "WEB-2"])
    expect(await list("-p", "WEB", "--status", "review")).toEqual(["WEB-5"])
  })

  test("--assignee: me, unassigned, an email or a name", async () => {
    expect(await list("-p", "WEB", "-a", "me")).toEqual(["WEB-1", "WEB-5"])
    expect(await list("-p", "WEB", "-a", "@me")).toEqual(["WEB-1", "WEB-5"])
    expect(await list("-p", "WEB", "-a", "unassigned")).toEqual(["WEB-4"])
    expect(await list("-p", "WEB", "-a", "mei member")).toEqual(["WEB-2", "WEB-5"])
    expect(await list("-p", "WEB", "-a", mei.email)).toEqual(["WEB-2", "WEB-5"])
    expect(await list("-p", "WEB", "-a", "Mei Member,unassigned")).toEqual([
      "WEB-4",
      "WEB-2",
      "WEB-5",
    ])
  })

  test("people and tags are named exactly, like task create: nobody matching exits 5", async () => {
    for (const args of [
      ["-a", "nobody@example.com"],
      ["-a", "mei"],
      ["-t", "nosuchtag"],
    ]) {
      const r = await w.box.run(["task", "list", "-p", "WEB", ...args])
      expect(r.exitCode, args.join(" ")).toBe(5)
      expect(r.stdout).toBe("")
    }
  })

  test("--tag, --priority and --due", async () => {
    expect(await list("-p", "WEB", "-t", "auth")).toEqual(["WEB-1"])
    expect(await list("-p", "WEB", "-t", "AUTH,bug")).toEqual(["WEB-1", "WEB-2"])
    expect(await list("-p", "WEB", "--priority", "high,urgent")).toEqual(["WEB-1", "WEB-5"])
    expect(await list("-p", "WEB", "--priority", "none")).toEqual(["WEB-2"])
    expect(await list("-p", "WEB", "--due", "overdue")).toEqual(["WEB-2"])
    expect(await list("-p", "WEB", "--due", "soon")).toEqual(["WEB-1"])
    expect(await list("-p", "WEB", "--due", "none")).toEqual(["WEB-4"])
    expect(await list("-p", "WEB", "--due", "2030-01-15")).toEqual(["WEB-5"])
  })

  test("-Q speaks the web search syntax and combines with the flags", async () => {
    expect(await list("-p", "WEB", "-Q", "assignee:me -tag:auth")).toEqual(["WEB-5"])
    expect(await list("-p", "WEB", "-Q", "oauth")).toEqual(["WEB-2"])
    expect(await list("-p", "WEB", "-Q", '"backlog idea"')).toEqual(["WEB-4"])
    expect(await list("-p", "WEB", "-Q", "has:due no:tag")).toEqual(["WEB-5"])
    expect(await list("-p", "WEB", "-s", "todo,review", "-Q", "priority:urgent")).toEqual(["WEB-5"])
    // The flags are sugar for the same terms.
    expect(await list("-p", "WEB", "-Q", "status:todo,in_progress assignee:me")).toEqual(
      await list("-p", "WEB", "-s", "todo,in_progress", "-a", "me"),
    )
  })

  test("--mine lists my tasks across projects, subtasks included", async () => {
    const r = await w.box.run(["task", "list", "--mine", "--json"])
    expect(r.exitCode).toBe(0)
    const tasks: { key: string; status: (typeof TASK_STATUSES)[number] }[] = r.json()
    expect(keysOf(tasks).sort()).toEqual(["API-1", "WEB-1", "WEB-5", "WEB-6"])
    const columns = tasks.map((t) => TASK_STATUSES.indexOf(t.status))
    expect(columns).toEqual([...columns].sort((a, b) => a - b))

    expect((await list("--mine", "--include-complete")).sort()).toEqual([
      "API-1",
      "API-2",
      "WEB-1",
      "WEB-3",
      "WEB-5",
      "WEB-6",
    ])
  })

  test("--parent lists a task's subtasks", async () => {
    expect(await list("--parent", "WEB-1")).toEqual(["WEB-6"])
    expect(await list("--parent", "web-2")).toEqual([])
  })

  test("--sort", async () => {
    expect(await list("-p", "WEB", "--sort", "priority")).toEqual([
      "WEB-5",
      "WEB-1",
      "WEB-4",
      "WEB-2",
    ])
    expect(await list("-p", "WEB", "--sort", "due")).toEqual(["WEB-2", "WEB-1", "WEB-5", "WEB-4"])
    expect((await list("-p", "WEB", "--sort", "updated"))[0]).toBe("WEB-2")
    expect(await list("-p", "WEB", "--sort", "board")).toEqual(["WEB-4", "WEB-1", "WEB-2", "WEB-5"])
  })

  test("--limit applies after filtering and sorting", async () => {
    expect(await list("-p", "WEB", "--limit", "2")).toEqual(["WEB-4", "WEB-1"])
    expect(await list("-p", "WEB", "-L", "1", "--sort", "priority")).toEqual(["WEB-5"])
  })

  test("piped output is TSV with names, not objects", async () => {
    const r = await w.box.run(["task", "list", "-p", "WEB", "-t", "auth"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe(`WEB-1\ttodo\thigh\tLogin redirect\tAlan Owner\tauth\t${tomorrow}\n`)
    const two = await w.box.run(["task", "list", "-p", "WEB", "-s", "review"])
    expect(two.stdout).toBe(
      "WEB-5\treview\turgent\tReview me\tAlan Owner,Mei Member\t\t2030-01-15\n",
    )
  })

  test("--json --fields, -q", async () => {
    const r = await w.box.run([
      "task",
      "list",
      "-p",
      "WEB",
      "-s",
      "todo",
      "--json",
      "--fields",
      "key,title,status",
    ])
    expect(r.json()).toEqual([{ key: "WEB-1", title: "Login redirect", status: "todo" }])

    const full = (await w.box.run(["task", "list", "-p", "WEB", "-s", "todo", "--json"])).json()
    expect(full[0].url).toBe(
      `${server.url}/w/${w.workspace.slug}/projects/${w.project.id}?task=${full[0].id}`,
    )
    expect(full[0].assignees).toEqual([expect.objectContaining({ name: "Alan Owner" })])

    const quiet = await w.box.run(["task", "list", "-p", "WEB", "-q"])
    expect(lines(quiet.stdout)).toEqual(["WEB-4", "WEB-1", "WEB-2", "WEB-5"])
  })

  test("a terminal gets one readable line per task", async () => {
    const r = await w.box.run(["task", "list", "-p", "WEB", "-s", "todo"], {
      env: { INTESA_FORCE_TTY: "120" },
    })
    expect(r.exitCode).toBe(0)
    const [line] = lines(r.stdout)
    for (const part of ["WEB-1", "Todo", "Login redirect", "High", "@alan", "#auth", "0/1"]) {
      expect(line).toContain(part)
    }
    expect(lines(r.stdout)).toHaveLength(1)
  })

  test("bad filters are usage errors", async () => {
    for (const args of [
      ["-s", "doing"],
      ["--priority", "huge"],
      ["--due", "someday"],
      ["--sort", "random"],
      ["--sort", "status"],
      ["--limit", "0"],
      ["--mine", "--parent", "WEB-1"],
    ]) {
      const r = await w.box.run(["task", "list", "-p", "WEB", ...args])
      expect(r.exitCode, args.join(" ")).toBe(2)
    }
  })

  test("without a project names -p", async () => {
    const r = await w.box.run(["task", "list"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("-p")
  })
})
