import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { world as baseWorld, removeSandboxes, startServer, type TestServer } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

// A world with a tag, a second person and one custom field of each type.
async function world() {
  const w = await baseWorld(server)
  const mei = await w.addPerson("Mei Member")
  const una = await w.addPerson("Una Unique")
  const auth = await w.addTag("auth")
  const bug = await w.addTag("bug")
  const field = async (name: string, type: string, options?: string[]) =>
    (await w.addField({ name, type, ...(options && { options }) })).id
  const fields = {
    estimate: await field("Estimate", "number"),
    shipped: await field("Shipped", "boolean"),
    launch: await field("Launch", "date"),
    stage: await field("Stage", "select", ["Alpha", "Beta"]),
    notes: await field("Notes", "text"),
  }
  return { ...w, mei, una, auth, bug, fields }
}

const names = (list: { name: string }[]) => list.map((x) => x.name)

describe("task create", () => {
  let w: Awaited<ReturnType<typeof world>>
  beforeAll(async () => {
    w = await world()
  })

  test("every flag ends up on the task", async () => {
    const r = await w.box.run([
      "task",
      "create",
      "-p",
      "web",
      "-T",
      "New thing",
      "-b",
      "Body **md**",
      "-s",
      "in_progress",
      "--priority",
      "high",
      "--due",
      "2030-02-03",
      "-a",
      "@me,Mei Member",
      "-t",
      "auth,BUG",
      "--field",
      "Estimate=5",
      "--field",
      "shipped=true",
      "--field",
      "Launch=2030-01-01",
      "--field",
      "Stage=Beta",
      "--field",
      "Notes=hello = world",
      "--json",
    ])
    expect(r.exitCode).toBe(0)
    const created = r.json()
    expect(created.key).toMatch(/^WEB-\d+$/)
    expect(created.url).toBe(
      `${server.url}/w/${w.workspace.slug}/projects/${w.project.id}?task=${created.id}`,
    )

    const task = await w.getTask(created.id)
    expect(task).toMatchObject({
      title: "New thing",
      body: "Body **md**",
      status: "in_progress",
      priority: "high",
      dueAt: "2030-02-03",
      parentTaskId: null,
    })
    expect(names(task.assignees)).toEqual(["Alan Owner", "Mei Member"])
    expect(names(task.tags)).toEqual(["auth", "bug"])
    expect(task.customFields).toEqual({
      [w.fields.estimate]: 5,
      [w.fields.shipped]: true,
      [w.fields.launch]: "2030-01-01",
      [w.fields.stage]: "Beta",
      [w.fields.notes]: "hello = world",
    })
  })

  test("defaults: todo, nobody assigned; prints the key when piped", async () => {
    const r = await w.box.run(["task", "create", "-p", "WEB", "-T", "Plain"])
    expect(r.exitCode).toBe(0)
    const key = r.stdout.split("\t")[0] ?? ""
    expect(key).toMatch(/^WEB-\d+$/)
    const task = (await w.box.run(["task", "view", key, "--json"])).json()
    expect(task).toMatchObject({ title: "Plain", status: "todo", priority: null, assignees: [] })
  })

  test("-F reads the body from a file or stdin", async () => {
    const path = join(w.box.root, "body.md")
    writeFileSync(path, "From a *file*\n")
    const fromFile = await w.box.run([
      "task",
      "create",
      "-p",
      "WEB",
      "-T",
      "F",
      "-F",
      path,
      "--json",
    ])
    expect((await w.getTask(fromFile.json().id)).body).toBe("From a *file*\n")
    const fromStdin = await w.box.run(
      ["task", "create", "-p", "WEB", "-T", "S", "--body-file", "-", "--json"],
      { stdin: "From stdin\n" },
    )
    expect((await w.getTask(fromStdin.json().id)).body).toBe("From stdin\n")
  })

  test("--parent makes a subtask in the parent's project", async () => {
    const parent = await w.addTask({ title: "Parent" })
    const r = await w.box.run(["task", "create", "--parent", parent.key, "-T", "Kid", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json().parentTaskId).toBe(parent.id)
    expect((await w.getTask(parent.id)).subtasks.map((s: { title: string }) => s.title)).toEqual([
      "Kid",
    ])
  })

  test("unknown tags exit 5 unless --create-tags", async () => {
    const before = (await w.projectTasks()).length
    const r = await w.box.run(["task", "create", "-p", "WEB", "-T", "Tagged", "-t", "auth,shiny"])
    expect(r.exitCode).toBe(5)
    expect(r.stderr).toContain("shiny")
    expect((await w.projectTasks()).length).toBe(before)

    const ok = await w.box.run([
      "task",
      "create",
      "-p",
      "WEB",
      "-T",
      "Tagged",
      "-t",
      "auth,shiny",
      "--create-tags",
      "--json",
    ])
    expect(ok.exitCode).toBe(0)
    expect(names(await w.tags())).toContain("shiny")
    expect(names((await w.getTask(ok.json().id)).tags)).toEqual(["auth", "shiny"])
  })

  test("field values are checked against the field's type before anything is created", async () => {
    const before = (await w.projectTasks()).length
    for (const [value, needle] of [
      ["Stage=Gamma", "Alpha"],
      ["Estimate=lots", "number"],
      ["Shipped=maybe", "true"],
      ["Launch=2030-02-31", "YYYY-MM-DD"],
      ["Estimate", "NAME=VALUE"],
    ] as const) {
      const r = await w.box.run(["task", "create", "-p", "WEB", "-T", "X", "--field", value])
      expect(r.exitCode, value).toBe(2)
      expect(r.stderr).toContain(needle)
    }
    const unknown = await w.box.run(["task", "create", "-p", "WEB", "-T", "X", "--field", "Nope=1"])
    expect(unknown.exitCode).toBe(5)
    expect((await w.projectTasks()).length).toBe(before)
  })

  test("usage errors: no title when not interactive, -b with -F, a bad due date", async () => {
    const noTitle = await w.box.run(["task", "create", "-p", "WEB"])
    expect(noTitle.exitCode).toBe(2)
    expect(noTitle.stderr).toContain("missing --title (required when not interactive)")
    const both = await w.box.run(["task", "create", "-p", "WEB", "-T", "X", "-b", "a", "-F", "-"])
    expect(both.exitCode).toBe(2)
    const due = await w.box.run(["task", "create", "-p", "WEB", "-T", "X", "--due", "soon"])
    expect(due.exitCode).toBe(2)
    expect(due.stderr).toContain("YYYY-MM-DD")
  })

  test("custom field values go with the task in its one request", async () => {
    const r = await w.box.run(
      ["task", "create", "-p", "WEB", "-T", "Valued", "--field", "Estimate=2", "--json"],
      { env: { INTESA_DEBUG: "1" } },
    )
    expect(r.exitCode).toBe(0)
    expect(r.stderr.match(/^> (POST|PATCH|PUT|DELETE) /gm)).toEqual(["> POST "])
    expect((await w.getTask(r.json().id)).customFields).toEqual({ [w.fields.estimate]: 2 })
  })
})

describe("task edit", () => {
  let w: Awaited<ReturnType<typeof world>>
  beforeAll(async () => {
    w = await world()
  })

  test("adding and removing assignees and tags keeps the others", async () => {
    const task = await w.addTask({
      title: "Shared",
      assigneeIds: [w.me, w.mei.id],
      tagIds: [w.auth.id],
    })
    const r = await w.box.run([
      "task",
      "edit",
      task.key,
      "--add-assignee",
      "una unique",
      "--remove-assignee",
      w.mei.email,
      "--add-tag",
      "bug",
      "--json",
    ])
    expect(r.exitCode).toBe(0)
    const after = await w.getTask(task.id)
    expect(names(after.assignees)).toEqual(["Alan Owner", "Una Unique"])
    expect(names(after.tags)).toEqual(["auth", "bug"])

    await w.box.run(["task", "edit", task.key, "--remove-tag", "AUTH", "--remove-assignee", "@me"])
    const again = await w.getTask(task.id)
    expect(names(again.assignees)).toEqual(["Una Unique"])
    expect(names(again.tags)).toEqual(["bug"])
  })

  test("title, body, priority and due; --no-priority and --no-due clear them", async () => {
    const task = await w.addTask({ title: "Old", priority: "low", dueAt: "2030-01-01" })
    const r = await w.box.run([
      "task",
      "edit",
      task.key,
      "-T",
      "New",
      "-b",
      "Text",
      "--priority",
      "urgent",
      "--json",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ key: task.key, title: "New", priority: "urgent" })
    expect((await w.getTask(task.id)).body).toBe("Text")

    await w.box.run(["task", "edit", task.key, "--no-priority", "--no-due"])
    expect(await w.getTask(task.id)).toMatchObject({ priority: null, dueAt: null, title: "New" })
  })

  test("--field sets and --clear-field clears custom field values", async () => {
    const task = await w.addTask({ title: "Fields" })
    await w.patchTask(task.id, {
      customFields: { [w.fields.stage]: "Alpha", [w.fields.estimate]: 1 },
    })
    const r = await w.box.run([
      "task",
      "edit",
      task.key,
      "--field",
      "Estimate=8",
      "--clear-field",
      "stage",
    ])
    expect(r.exitCode).toBe(0)
    expect((await w.getTask(task.id)).customFields).toEqual({ [w.fields.estimate]: 8 })
  })

  test("unknown tags exit 5 with a pointer to --create-tags, which creates them", async () => {
    const task = await w.addTask({ title: "Tags" })
    const r = await w.box.run(["task", "edit", task.key, "--add-tag", "fresh"])
    expect(r.exitCode).toBe(5)
    expect(r.stderr).toContain("--create-tags")
    const ok = await w.box.run(["task", "edit", task.key, "--add-tag", "fresh", "--create-tags"])
    expect(ok.exitCode).toBe(0)
    expect(names((await w.getTask(task.id)).tags)).toEqual(["fresh"])
  })

  test("nothing to change is a usage error", async () => {
    const task = await w.addTask({ title: "Same" })
    const r = await w.box.run(["task", "edit", task.key])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--title")
  })
})
