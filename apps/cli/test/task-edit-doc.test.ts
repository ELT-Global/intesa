import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { removeSandboxes, startServer, type TestServer, type World, world } from "./helpers"

// `task edit TASK` without flags, driven by INTESA_EDITOR: how a script edits a task as a
// document. The editor below saves a copy of what it was given to COPY_TO, then applies the
// [from, to] replacements in EDITS.

let server: TestServer
let w: World
let editor: string
let mei: { id: string; name: string }
let estimateId: string

// The JSON error envelope is the last stderr line; debug request lines come before it.
const errorOf = (r: { stderr: string }) =>
  JSON.parse(r.stderr.trim().split("\n").at(-1) as string).error as { message: string }

beforeAll(async () => {
  server = await startServer()
  w = await world(server)
  mei = await w.addPerson("Mei Member")
  await w.addTag("auth")
  await w.addTag("bug")
  estimateId = (await w.addField({ name: "Estimate", type: "number" })).id
  editor = join(w.box.root, "editor.ts")
  writeFileSync(
    editor,
    `const path = process.argv[2]
let text = await Bun.file(path).text()
if (process.env.COPY_TO) await Bun.write(process.env.COPY_TO, text)
for (const [from, to] of JSON.parse(process.env.EDITS ?? "[]")) {
  if (!text.includes(from)) process.exit(42)
  text = text.replace(from, to)
}
await Bun.write(path, text)`,
  )
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

async function seed() {
  const tags = await w.tags()
  const auth = tags.find((t) => t.name === "auth")?.id
  const task = await w.addTask({
    title: "Fix login redirect",
    body: "Old notes.\n",
    priority: "high",
    dueAt: "2030-01-02",
    assigneeIds: [w.me],
    tagIds: [auth],
  })
  await w.addTask({ title: "A step", parentTaskId: task.id })
  return task
}

const edit = (key: string, edits: [string, string][], env: Record<string, string> = {}) =>
  w.box.run(["task", "edit", key, "--json"], {
    env: {
      INTESA_EDITOR: `"${process.execPath}" "${editor}"`,
      EDITS: JSON.stringify(edits),
      INTESA_DEBUG: "1",
      ...env,
    },
  })

const patches = (stderr: string) => stderr.split("\n").filter((l) => l.startsWith("> PATCH"))

describe("task edit in the editor", () => {
  test("the task as a front-matter document", async () => {
    const task = await seed()
    const copy = join(w.box.root, "seen.md")
    const r = await edit(task.key, [], { COPY_TO: copy })
    expect(r.exitCode, r.stderr).toBe(0)
    expect(readFileSync(copy, "utf8")).toBe(
      [
        "---",
        "title: Fix login redirect",
        "status: todo",
        "priority: high",
        "due: 2030-01-02",
        "assignees: [@me]",
        "tags: [auth]",
        "reviewedBy:",
        "testedBy:",
        "fields: { Estimate: null }",
        "---",
        "Old notes.",
        "",
      ].join("\n"),
    )
    expect(r.stderr).toContain("No changes")
    expect(patches(r.stderr)).toEqual([])
  })

  test("reviewedBy and testedBy answer who reviewed and tested it, and none is nobody", async () => {
    const task = await seed()
    const r = await edit(task.key, [
      ["reviewedBy:", "reviewedBy: Mei Member"],
      ["testedBy:", "testedBy: none"],
    ])
    expect(r.exitCode, r.stderr).toBe(0)
    expect(patches(r.stderr)).toHaveLength(1)
    const saved = await w.getTask(task.id)
    expect(saved.reviewedBy).toMatchObject({ id: mei.id })
    expect(saved.testedBy).toBeNull()

    // Shown the same way next time; an answer can change but not go back to empty.
    const copy = join(w.box.root, "answered.md")
    const again = await edit(task.key, [], { COPY_TO: copy })
    expect(again.stderr).toContain("No changes")
    expect(readFileSync(copy, "utf8")).toContain("\nreviewedBy: Mei Member\ntestedBy: none\n")
    const cleared = await edit(task.key, [["reviewedBy: Mei Member", "reviewedBy:"]])
    expect(cleared.exitCode).toBe(2)
    expect(errorOf(cleared).message).toContain("reviewedBy is already answered")
    expect((await w.getTask(task.id)).reviewedBy).toMatchObject({ id: mei.id })
  })

  test("completing from the document needs the answers", async () => {
    const task = await seed()
    const refused = await edit(task.key, [["status: todo", "status: complete"]])
    expect(refused.exitCode).toBe(8)
    expect(errorOf(refused).message).toContain("Record who reviewed and who tested")
    expect((await w.getTask(task.id)).status).toBe("todo")

    const r = await edit(task.key, [
      ["status: todo", "status: complete"],
      ["reviewedBy:", "reviewedBy: @me"],
      ["testedBy:", "testedBy: none"],
    ])
    expect(r.exitCode, r.stderr).toBe(0)
    expect((await w.getTask(task.id)).status).toBe("complete")
  })

  test("status, a tag and the description change with one PATCH", async () => {
    const task = await seed()
    const r = await edit(task.key, [
      ["status: todo", "status: review"],
      ["tags: [auth]", "tags: [auth, bug]"],
      ["Old notes.", "New notes, *edited*."],
    ])
    expect(r.exitCode, r.stderr).toBe(0)
    expect(patches(r.stderr)).toHaveLength(1)

    const saved = await w.getTask(task.id)
    expect(saved).toMatchObject({
      title: "Fix login redirect",
      status: "review",
      body: "New notes, *edited*.",
      priority: "high",
      dueAt: "2030-01-02",
    })
    expect(saved.tags.map((t: { name: string }) => t.name)).toEqual(["auth", "bug"])
    // Like `task move` without a terminal: subtasks stay, and the output says so.
    expect(r.json()).toMatchObject({
      key: task.key,
      status: "review",
      subtasksOutOfSync: [{ key: saved.subtasks[0].key, status: "todo" }],
    })
  })

  test("people, fields and cleared values", async () => {
    const task = await seed()
    const r = await edit(task.key, [
      ["priority: high", "priority:"],
      ["due: 2030-01-02", "due: none"],
      ["assignees: [@me]", "assignees: [Mei Member]"],
      ["Estimate: null", "Estimate: 5"],
    ])
    expect(r.exitCode, r.stderr).toBe(0)
    expect(patches(r.stderr)).toHaveLength(1)
    const saved = await w.getTask(task.id)
    expect(saved).toMatchObject({ priority: null, dueAt: null, status: "todo" })
    expect(saved.assignees.map((a: { id: string }) => a.id)).toEqual([mei.id])
    expect(saved.customFields).toEqual({ [estimateId]: 5 })
  })

  test("a field named with = and a text value with a comma", async () => {
    const ops = await w.addProject("Ops", "OPS")
    const size = await w.addField({ name: "Size=Est", type: "number" }, ops.id)
    const notes = await w.addField({ name: "Notes", type: "text" }, ops.id)
    const task = await w.addTask(
      { title: "Weigh it", customFields: { [notes.id]: "red, green" } },
      ops.id,
    )
    const r = await edit(task.key, [
      ["Size=Est: null", "Size=Est: 4"],
      ['Notes: "red, green"', 'Notes: "red, green, blue"'],
    ])
    expect(r.exitCode, r.stderr).toBe(0)
    expect((await w.getTask(task.id)).customFields).toEqual({
      [size.id]: 4,
      [notes.id]: "red, green, blue",
    })
  })

  test("an unknown tag exits 5 and changes nothing", async () => {
    const task = await seed()
    const before = await w.getTask(task.id)
    const r = await edit(task.key, [
      ["title: Fix login redirect", "title: Renamed"],
      ["tags: [auth]", "tags: [auth, nope]"],
    ])
    expect(r.exitCode).toBe(5)
    expect(errorOf(r).message).toContain('no tag matches "nope"')
    expect(patches(r.stderr)).toEqual([])
    expect(await w.getTask(task.id)).toEqual(before)
    expect((await w.tags()).map((t) => t.name)).not.toContain("nope")
  })

  test("a document mistake is a usage error naming the line", async () => {
    const task = await seed()
    const r = await edit(task.key, [["status: todo", "status: doing"]])
    expect(r.exitCode).toBe(2)
    expect(errorOf(r).message).toContain('line 3: unknown status "doing"')
    expect(patches(r.stderr)).toEqual([])
  })

  test("a field value of the wrong type is a usage error", async () => {
    const task = await seed()
    const r = await edit(task.key, [["Estimate: null", "Estimate: lots"]])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("expected a number")
  })

  test("without INTESA_EDITOR or a terminal it stays a usage error", async () => {
    const task = await seed()
    const r = await w.box.run(["task", "edit", task.key])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("INTESA_EDITOR")
  })
})
