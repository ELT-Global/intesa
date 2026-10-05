import { describe, expect, test } from "bun:test"
import { addMember, createTestApp, setupProject, signIn } from "./helpers"

async function setup() {
  const t = await createTestApp()
  const ctx = await setupProject(t, "owner@example.com")
  const fieldsUrl = `/api/projects/${ctx.project.id}/custom-fields`
  const field = async (body: Record<string, unknown>) => {
    const res = await ctx.owner.call("POST", fieldsUrl, body)
    expect(res.status).toBe(201)
    return res.body.field as { id: string; options: string[] }
  }
  const task = async () =>
    (await ctx.owner.call("POST", `/api/projects/${ctx.project.id}/tasks`, { title: "T" })).body
      .task as { id: string }
  const setValues = (taskId: string, customFields: Record<string, unknown>) =>
    ctx.owner.call("PATCH", `/api/tasks/${taskId}`, { customFields })
  const values = async (taskId: string) =>
    (await ctx.owner.call("GET", `/api/tasks/${taskId}`)).body.task.customFields
  return { t, ...ctx, fieldsUrl, field, task, setValues, values }
}

describe("custom field definitions", () => {
  test("create, list in position order, and the full shape", async () => {
    const { owner, project, fieldsUrl } = await setup()
    const a = await owner.call("POST", fieldsUrl, {
      name: "Estimate",
      type: "number",
      required: true,
    })
    expect(a.body.field).toMatchObject({
      projectId: project.id,
      name: "Estimate",
      type: "number",
      required: true,
      options: [],
      position: 0,
    })
    const b = await owner.call("POST", fieldsUrl, {
      name: "Stage",
      type: "select",
      options: ["Design", "Build"],
    })
    expect(b.body.field).toMatchObject({
      required: false,
      options: ["Design", "Build"],
      position: 1,
    })

    const list = await owner.call("GET", fieldsUrl)
    expect(list.body.fields.map((f: { name: string }) => f.name)).toEqual(["Estimate", "Stage"])
  })

  test.each([
    ["empty name", { name: "", type: "text" }],
    ["unknown type", { name: "X", type: "color" }],
    ["select without options", { name: "X", type: "select" }],
    ["select with empty options", { name: "X", type: "select", options: [] }],
    ["duplicate options", { name: "X", type: "select", options: ["a", "a"] }],
    ["options on a non-select", { name: "X", type: "text", options: ["a"] }],
  ])("rejects %s", async (_l, payload) => {
    const { owner, fieldsUrl } = await setup()
    const res = await owner.call("POST", fieldsUrl, payload)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })

  test("names are unique per project regardless of case", async () => {
    const { owner, workspaceId, field, fieldsUrl } = await setup()
    await field({ name: "Estimate", type: "number" })
    expect((await owner.call("POST", fieldsUrl, { name: "estimate", type: "text" })).status).toBe(
      409,
    )

    const other = await owner.call("POST", `/api/workspaces/${workspaceId}/projects`, {
      name: "Other",
    })
    const ok = await owner.call("POST", `/api/projects/${other.body.project.id}/custom-fields`, {
      name: "Estimate",
      type: "number",
    })
    expect(ok.status).toBe(201)
  })

  test("PATCH renames, toggles required and edits options; type is immutable", async () => {
    const { owner, field } = await setup()
    const f = await field({ name: "Stage", type: "select", options: ["a", "b"] })
    const res = await owner.call("PATCH", `/api/custom-fields/${f.id}`, {
      name: "Phase",
      required: true,
      options: ["a", "b", "c"],
      type: "text",
    })
    expect(res.status).toBe(200)
    expect(res.body.field).toMatchObject({
      name: "Phase",
      type: "select",
      required: true,
      options: ["a", "b", "c"],
    })

    const text = await field({ name: "Notes", type: "text" })
    const bad = await owner.call("PATCH", `/api/custom-fields/${text.id}`, { options: ["x"] })
    expect(bad.status).toBe(400)
    expect((await owner.call("PATCH", `/api/custom-fields/${f.id}`, { options: [] })).status).toBe(
      400,
    )
    expect(
      (await owner.call("PATCH", `/api/custom-fields/${f.id}`, { name: "notes" })).status,
    ).toBe(409)
  })

  test("any workspace member can edit definitions", async () => {
    const { t, workspaceId, fieldsUrl } = await setup()
    const member = await signIn(t.app, "mem@example.com")
    await addMember(t, workspaceId, "mem@example.com")
    const created = await member.call("POST", fieldsUrl, { name: "Mine", type: "text" })
    expect(created.status).toBe(201)
    expect(
      (await member.call("DELETE", `/api/custom-fields/${created.body.field.id}`)).status,
    ).toBe(204)
  })

  test("every field route is 404 for outsiders", async () => {
    const { t, field, fieldsUrl } = await setup()
    const f = await field({ name: "Secret", type: "text" })
    const outsider = await signIn(t.app, "out@example.com")
    const calls: [string, string, unknown?][] = [
      ["GET", fieldsUrl],
      ["POST", fieldsUrl, { name: "Sneaky", type: "text" }],
      ["PATCH", `/api/custom-fields/${f.id}`, { name: "Sneaky" }],
      ["DELETE", `/api/custom-fields/${f.id}`],
    ]
    for (const [method, path, body] of calls) {
      expect([method, path, (await outsider.call(method, path, body)).status]).toEqual([
        method,
        path,
        404,
      ])
    }
  })
})

describe("custom field values", () => {
  test("each type stores and returns its value; detail lists them keyed by field id", async () => {
    const { field, task, setValues, values } = await setup()
    const text = await field({ name: "Notes", type: "text" })
    const num = await field({ name: "Estimate", type: "number" })
    const bool = await field({ name: "Billable", type: "boolean" })
    const date = await field({ name: "Review", type: "date" })
    const sel = await field({ name: "Stage", type: "select", options: ["Design", "Build"] })
    const t1 = await task()

    const res = await setValues(t1.id, {
      [text.id]: "hello",
      [num.id]: 3.5,
      [bool.id]: false,
      [date.id]: "2026-03-15",
      [sel.id]: "Build",
    })
    expect(res.status).toBe(200)
    expect(await values(t1.id)).toEqual({
      [text.id]: "hello",
      [num.id]: 3.5,
      [bool.id]: false,
      [date.id]: "2026-03-15",
      [sel.id]: "Build",
    })

    // Overwrite keeps exactly one value per field.
    await setValues(t1.id, { [num.id]: 0 })
    expect((await values(t1.id))[num.id]).toBe(0)
  })

  test("a task with no values has an empty map", async () => {
    const { task, values } = await setup()
    expect(await values((await task()).id)).toEqual({})
  })

  test.each([
    ["text", { name: "F", type: "text" }, 5],
    ["text too long", { name: "F", type: "text" }, "x".repeat(2001)],
    ["number as string", { name: "F", type: "number" }, "5"],
    ["boolean as string", { name: "F", type: "boolean" }, "true"],
    ["date format", { name: "F", type: "date" }, "03/15/2026"],
    ["impossible date", { name: "F", type: "date" }, "2026-02-31"],
    ["date out of range", { name: "F", type: "date" }, "2026-13-45"],
    ["select outside options", { name: "F", type: "select", options: ["a"] }, "b"],
  ])("rejects an invalid %s value", async (_l, def, value) => {
    const { field, task, setValues, values } = await setup()
    const f = await field(def)
    const t1 = await task()
    const res = await setValues(t1.id, { [f.id]: value })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
    expect(await values(t1.id)).toEqual({})
  })

  test("text at the limit is accepted", async () => {
    const { field, task, setValues } = await setup()
    const f = await field({ name: "Notes", type: "text" })
    expect((await setValues((await task()).id, { [f.id]: "x".repeat(2000) })).status).toBe(200)
  })

  test("null clears a value; required values cannot be cleared once set", async () => {
    const { field, task, setValues, values } = await setup()
    const optional = await field({ name: "Notes", type: "text" })
    const required = await field({ name: "Estimate", type: "number", required: true })
    const t1 = await task()
    await setValues(t1.id, { [optional.id]: "a", [required.id]: 2 })

    expect((await setValues(t1.id, { [optional.id]: null })).status).toBe(200)
    expect(await values(t1.id)).toEqual({ [required.id]: 2 })

    const res = await setValues(t1.id, { [required.id]: null })
    expect(res.status).toBe(400)
    expect(await values(t1.id)).toEqual({ [required.id]: 2 })
    // Replacing a required value is fine.
    expect((await setValues(t1.id, { [required.id]: 9 })).status).toBe(200)
  })

  test("a field from another project or an unknown field is rejected", async () => {
    const { owner, workspaceId, task, setValues } = await setup()
    const other = await owner.call("POST", `/api/workspaces/${workspaceId}/projects`, {
      name: "Other",
    })
    const foreign = await owner.call(
      "POST",
      `/api/projects/${other.body.project.id}/custom-fields`,
      {
        name: "Theirs",
        type: "text",
      },
    )
    const t1 = await task()
    expect((await setValues(t1.id, { [foreign.body.field.id]: "x" })).status).toBe(400)
    expect((await setValues(t1.id, { nope: "x" })).status).toBe(400)
  })

  test("a bad value rolls back the rest of the PATCH", async () => {
    const { owner, field, task } = await setup()
    const f = await field({ name: "Estimate", type: "number" })
    const t1 = await task()
    const res = await owner.call("PATCH", `/api/tasks/${t1.id}`, {
      title: "Changed",
      status: "complete",
      customFields: { [f.id]: "oops" },
    })
    expect(res.status).toBe(400)
    const after = await owner.call("GET", `/api/tasks/${t1.id}`)
    expect(after.body.task).toMatchObject({ title: "T", status: "todo" })
  })

  test("deleting a field removes its values from tasks", async () => {
    const { owner, field, task, setValues, values } = await setup()
    const keep = await field({ name: "Keep", type: "text" })
    const drop = await field({ name: "Drop", type: "text" })
    const t1 = await task()
    await setValues(t1.id, { [keep.id]: "k", [drop.id]: "d" })

    expect((await owner.call("DELETE", `/api/custom-fields/${drop.id}`)).status).toBe(204)
    expect(await values(t1.id)).toEqual({ [keep.id]: "k" })
  })

  test("removing a select option clears the values that used it, in the same edit", async () => {
    const { owner, field, task, setValues, values } = await setup()
    const f = await field({ name: "Stage", type: "select", options: ["a", "b", "c"] })
    const t1 = await task()
    const t2 = await task()
    const t3 = await task()
    await setValues(t1.id, { [f.id]: "a" })
    await setValues(t2.id, { [f.id]: "b" })
    await setValues(t3.id, { [f.id]: "c" })

    const res = await owner.call("PATCH", `/api/custom-fields/${f.id}`, {
      options: ["b", "c", "d"],
    })
    expect(res.body.field.options).toEqual(["b", "c", "d"])
    expect(await values(t1.id)).toEqual({})
    expect(await values(t2.id)).toEqual({ [f.id]: "b" })
    expect(await values(t3.id)).toEqual({ [f.id]: "c" })
  })

  test("deleting a project or task cleans up its values", async () => {
    const { t, owner, project, field, task, setValues } = await setup()
    const f = await field({ name: "Notes", type: "text" })
    const t1 = await task()
    await setValues(t1.id, { [f.id]: "x" })
    await owner.call("DELETE", `/api/projects/${project.id}`)
    expect(await t.db.selectFrom("taskCustomFieldValues").selectAll().execute()).toEqual([])
    expect(await t.db.selectFrom("customFieldDefinitions").selectAll().execute()).toEqual([])
  })

  test("outsiders cannot set values", async () => {
    const { t, field, task } = await setup()
    const f = await field({ name: "Notes", type: "text" })
    const t1 = await task()
    const outsider = await signIn(t.app, "out@example.com")
    const res = await outsider.call("PATCH", `/api/tasks/${t1.id}`, {
      customFields: { [f.id]: "x" },
    })
    expect(res.status).toBe(404)
  })
})
