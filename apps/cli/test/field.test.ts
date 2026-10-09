import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { FIELD_TYPES } from "@intesa/api/schemas"
import { loginAs, removeSandboxes, sandbox, startServer, type TestServer } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

type Field = {
  id: string
  projectId: string
  name: string
  type: string
  required: boolean
  options: string[]
  position: number
}

let n = 0
// A signed-in sandbox that owns one workspace with a project WEB, passed as -p WEB by `run`.
async function setup() {
  const id = ++n
  const box = sandbox(server.url)
  const { session } = await loginAs(box, server, `field${id}@example.com`)
  const ws = await session.call("POST", "/api/workspaces", { name: "Acme", slug: `acme-${id}` })
  const workspace = ws.body.workspace as { id: string; slug: string }
  const project = (
    await session.call("POST", `/api/workspaces/${workspace.id}/projects`, {
      name: "Web",
      key: "WEB",
    })
  ).body.project as { id: string }

  const run = (args: string[]) => box.run([...args, "-p", "WEB"])
  const fields = async (): Promise<Field[]> => (await run(["field", "list", "--json"])).json()
  const add = async (body: Record<string, unknown>) =>
    (await session.call("POST", `/api/projects/${project.id}/custom-fields`, body)).body
      .field as Field
  // A task with `value` stored in `field`, to see what happens to values when a field changes.
  const taskWith = async (field: Field, value: unknown) => {
    const task = (
      await session.call("POST", `/api/projects/${project.id}/tasks`, { title: "Has a value" })
    ).body.task
    await session.call("PATCH", `/api/tasks/${task.id}`, { customFields: { [field.id]: value } })
    return async () =>
      (await session.call("GET", `/api/tasks/${task.id}`)).body.task.customFields as Record<
        string,
        unknown
      >
  }
  return { box, session, project, run, fields, add, taskWith }
}

describe("field create", () => {
  test.each(FIELD_TYPES.filter((t) => t !== "select"))("a %s field", async (type) => {
    const { run, fields, project } = await setup()
    const r = await run(["field", "create", "Notes", "--type", type, "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({
      id: expect.any(String),
      projectId: project.id,
      name: "Notes",
      type,
      required: false,
      options: [],
      position: 0,
    })
    expect(await fields()).toEqual([r.json()])
  })

  test("a select field keeps its --option values in order", async () => {
    const { run } = await setup()
    const r = await run([
      "field",
      "create",
      "Stage",
      "--type",
      "select",
      "--option",
      "Alpha",
      "--option",
      "Beta",
      "--option",
      "GA",
      "--json",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ type: "select", options: ["Alpha", "Beta", "GA"] })
  })

  test("--required, and positions follow creation order", async () => {
    const { run } = await setup()
    const first = await run(["field", "create", "First", "--type", "text", "--required", "--json"])
    expect(first.json()).toMatchObject({ required: true, position: 0 })
    const second = await run(["field", "create", "Second", "--type", "number", "--json"])
    expect(second.json()).toMatchObject({ required: false, position: 1 })
  })

  test("the type is required and must be a known one", async () => {
    const { run, fields } = await setup()
    const missing = await run(["field", "create", "Nameless"])
    expect(missing.exitCode).toBe(2)
    expect(missing.stderr).toContain("--type")
    const unknown = await run(["field", "create", "Odd", "--type", "color"])
    expect(unknown.exitCode).toBe(2)
    expect(unknown.stderr).toContain(FIELD_TYPES.join("|"))
    expect(await fields()).toEqual([])
  })

  test("a select needs options, and only a select takes them", async () => {
    const { run, fields } = await setup()
    const none = await run(["field", "create", "Stage", "--type", "select"])
    expect(none.exitCode).toBe(2)
    expect(none.stderr).toContain("--option")
    const text = await run(["field", "create", "Notes", "--type", "text", "--option", "x"])
    expect(text.exitCode).toBe(2)
    expect(text.stderr).toContain("--option")
    expect(await fields()).toEqual([])
  })

  test("a name taken in another case exits 6", async () => {
    const { run, add, fields } = await setup()
    await add({ name: "Estimate", type: "number" })
    const r = await run(["field", "create", "ESTIMATE", "--type", "text"])
    expect(r.exitCode).toBe(6)
    expect(r.stderr).toContain("already exists")
    expect(await fields()).toHaveLength(1)
  })

  test("repeated options are rejected by the server (exit 8)", async () => {
    const { run } = await setup()
    const r = await run([
      "field",
      "create",
      "Dup",
      "--type",
      "select",
      "--option",
      "a",
      "--option",
      "a",
    ])
    expect(r.exitCode).toBe(8)
  })

  test("the same name is fine in another project", async () => {
    const { box, session, run, add } = await setup()
    await add({ name: "Estimate", type: "number" })
    const ws = (await box.run(["ws", "list", "--json"])).json()[0].id
    await session.call("POST", `/api/workspaces/${ws}/projects`, { name: "Api", key: "API" })
    const r = await box.run(["field", "create", "Estimate", "--type", "number", "-p", "API"])
    expect(r.exitCode).toBe(0)
    expect((await run(["field", "list", "--json"])).json()).toHaveLength(1)
    const api = await box.run(["field", "list", "-p", "API", "--json"])
    expect(api.json().map((f: Field) => f.name)).toEqual(["Estimate"])
  })

  test("a project is needed: none is a usage error naming -p, an unknown key exits 5", async () => {
    const { box } = await setup()
    const none = await box.run(["field", "create", "X", "--type", "text"])
    expect(none.exitCode).toBe(2)
    expect(none.stderr).toContain("-p")
    expect((await box.run(["field", "create", "X", "--type", "text", "-p", "NOPE"])).exitCode).toBe(
      5,
    )
  })

  test("--dry-run shows the request body the flags produce", async () => {
    const { run, project, fields } = await setup()
    const r = await run([
      "field",
      "create",
      "Stage",
      "--type",
      "select",
      "--option",
      "A",
      "--required",
      "--dry-run",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({
      method: "POST",
      path: `/api/projects/${project.id}/custom-fields`,
      body: { name: "Stage", type: "select", required: true, options: ["A"] },
    })
    expect(await fields()).toEqual([])
  })

  test("a read-only token cannot create fields (exit 7)", async () => {
    const id = ++n
    const box = sandbox(server.url)
    const { session } = await loginAs(box, server, `field-ro${id}@example.com`, { scope: "read" })
    const ws = await session.call("POST", "/api/workspaces", { name: "Acme", slug: `acme-ro${id}` })
    await session.call("POST", `/api/workspaces/${ws.body.workspace.id}/projects`, {
      name: "Web",
      key: "WEB",
    })
    const r = await box.run(["field", "create", "X", "--type", "text", "-p", "WEB"])
    expect(r.exitCode).toBe(7)
  })
})

describe("field list", () => {
  test("--json is ordered by position", async () => {
    const { run, add } = await setup()
    const b = await add({ name: "B", type: "text" })
    const a = await add({ name: "A", type: "select", options: ["x", "y"], required: true })
    const r = await run(["field", "list", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual([b, a])
  })

  test("piped output is id, name, type, required and options", async () => {
    const { run, add } = await setup()
    const text = await add({ name: "Notes", type: "text" })
    const stage = await add({
      name: "Stage",
      type: "select",
      options: ["Alpha", "Beta"],
      required: true,
    })
    const r = await run(["field", "ls"])
    expect(r.stdout).toBe(
      `${text.id}\tNotes\ttext\tfalse\t\n${stage.id}\tStage\tselect\ttrue\tAlpha,Beta\n`,
    )
  })

  test("--fields and -q", async () => {
    const { run, add } = await setup()
    const f = await add({ name: "Due", type: "date" })
    const fields = await run(["field", "list", "--json", "--fields", "name,type"])
    expect(fields.json()).toEqual([{ name: "Due", type: "date" }])
    expect((await run(["field", "list", "-q"])).stdout).toBe(`${f.id}\n`)
    expect((await run(["field", "list", "--fields", "nope"])).exitCode).toBe(2)
  })
})

describe("field edit", () => {
  test("renames, finding the field by name in any case or by id", async () => {
    const { run, add } = await setup()
    const f = await add({ name: "Estimate", type: "number" })
    const r = await run(["field", "edit", "estimate", "--name", "Points", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({ ...f, name: "Points" })
    const byId = await run(["field", "edit", f.id, "--name", "Size", "--json"])
    expect(byId.json().name).toBe("Size")
  })

  test("--required and --no-required toggle the flag and leave the rest alone", async () => {
    const { run, add } = await setup()
    const f = await add({ name: "Owner", type: "text" })
    const on = await run(["field", "edit", "Owner", "--required", "--json"])
    expect(on.json()).toEqual({ ...f, required: true })
    const off = await run(["field", "edit", "Owner", "--no-required", "--json"])
    expect(off.json()).toEqual({ ...f, required: false })
  })

  test("--add-option appends and --remove-option removes, in one edit too", async () => {
    const { run, add } = await setup()
    await add({ name: "Stage", type: "select", options: ["Alpha", "Beta"] })
    const added = await run(["field", "edit", "Stage", "--add-option", "GA", "--json"])
    expect(added.json().options).toEqual(["Alpha", "Beta", "GA"])

    const both = await run([
      "field",
      "edit",
      "Stage",
      "--remove-option",
      "Alpha",
      "--add-option",
      "RC",
      "--add-option",
      "Final",
      "--json",
    ])
    expect(both.exitCode).toBe(0)
    expect(both.json().options).toEqual(["Beta", "GA", "RC", "Final"])
  })

  test("adding an option that exists changes nothing", async () => {
    const { run, add } = await setup()
    await add({ name: "Stage", type: "select", options: ["Alpha"] })
    const r = await run(["field", "edit", "Stage", "--add-option", " Alpha ", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json().options).toEqual(["Alpha"])
  })

  test("--remove-option warns on stderr and clears the stored values that used it", async () => {
    const { run, add, taskWith } = await setup()
    const stage = await add({ name: "Stage", type: "select", options: ["Alpha", "Beta"] })
    const onAlpha = await taskWith(stage, "Alpha")
    const onBeta = await taskWith(stage, "Beta")

    const r = await run(["field", "edit", "Stage", "--remove-option", "Alpha", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain("warning")
    expect(r.stderr).toContain("Alpha")
    expect(r.stdout).not.toContain("warning")
    expect(await onAlpha()).toEqual({})
    expect(await onBeta()).toEqual({ [stage.id]: "Beta" })
  })

  test("removing an option the field does not have is a usage error and changes nothing", async () => {
    const { run, add } = await setup()
    const stage = await add({ name: "Stage", type: "select", options: ["Alpha", "Beta"] })
    const r = await run(["field", "edit", "Stage", "--remove-option", "Gamma"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("Gamma")
    expect(r.stderr).not.toContain("warning")
    expect((await run(["field", "list", "--json"])).json()).toEqual([stage])
  })

  test("removing every option is rejected by the server (exit 8)", async () => {
    const { run, add } = await setup()
    await add({ name: "Stage", type: "select", options: ["Alpha"] })
    expect((await run(["field", "edit", "Stage", "--remove-option", "Alpha"])).exitCode).toBe(8)
  })

  test("option flags on a field that is not a select are a usage error", async () => {
    const { run, add } = await setup()
    await add({ name: "Notes", type: "text" })
    for (const flag of ["--add-option", "--remove-option"]) {
      const r = await run(["field", "edit", "Notes", flag, "x"])
      expect(r.exitCode).toBe(2)
      expect(r.stderr).toContain("select")
    }
  })

  test("renaming onto another field's name exits 6", async () => {
    const { run, add } = await setup()
    await add({ name: "One", type: "text" })
    await add({ name: "Two", type: "text" })
    expect((await run(["field", "edit", "Two", "--name", "one"])).exitCode).toBe(6)
  })

  test("nothing to change is a usage error naming the flags", async () => {
    const { run, add } = await setup()
    await add({ name: "Same", type: "text" })
    const r = await run(["field", "edit", "Same"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--name")
    expect(r.stderr).toContain("--required")
  })

  test("an unknown field exits 5", async () => {
    const { run } = await setup()
    const r = await run(["field", "edit", "ghost", "--name", "x"])
    expect(r.exitCode).toBe(5)
    expect(r.stderr).toContain("ghost")
  })
})

describe("field delete", () => {
  test("refuses without --yes when it cannot prompt, and keeps the field", async () => {
    const { run, add, fields } = await setup()
    await add({ name: "Keep", type: "text" })
    const r = await run(["field", "delete", "Keep"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--yes")
    expect(await fields()).toHaveLength(1)
  })

  test("--yes deletes the field and the values stored for it", async () => {
    const { run, add, fields, taskWith } = await setup()
    const f = await add({ name: "Doomed", type: "text" })
    const values = await taskWith(f, "hello")
    expect(await values()).toEqual({ [f.id]: "hello" })

    const r = await run(["field", "delete", "doomed", "--yes"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect(await fields()).toEqual([])
    expect(await values()).toEqual({})
  })

  test("--json reports what was deleted", async () => {
    const { run, add } = await setup()
    const f = await add({ name: "Gone", type: "text" })
    const r = await run(["field", "delete", "Gone", "--yes", "--json"])
    expect(r.json()).toEqual({ id: f.id, name: "Gone", deleted: true })
  })

  test("--dry-run needs no confirmation and keeps the field", async () => {
    const { run, add, fields } = await setup()
    const f = await add({ name: "Dry", type: "text" })
    const r = await run(["field", "delete", "Dry", "--dry-run"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({ method: "DELETE", path: `/api/custom-fields/${f.id}`, body: null })
    expect(await fields()).toHaveLength(1)
  })
})
