import { describe, expect, test } from "bun:test"
import { addMember, createTestApp, setupProject, signIn } from "./helpers"

async function setup() {
  const t = await createTestApp()
  const ctx = await setupProject(t, "owner@example.com")
  return { t, ...ctx, url: `/api/workspaces/${ctx.workspaceId}/tags` }
}

describe("tags", () => {
  test("create returns the tag; list is sorted by name", async () => {
    const { owner, url } = await setup()
    const created = await owner.call("POST", url, { name: "  Bug " })
    expect(created.status).toBe(201)
    expect(created.body.tag).toMatchObject({ name: "Bug", color: "blue" })
    expect(typeof created.body.tag.id).toBe("string")
    await owner.call("POST", url, { name: "Alpha" })

    const list = await owner.call("GET", url)
    expect(list.body.tags.map((x: { name: string }) => x.name)).toEqual(["Alpha", "Bug"])
  })

  test("default colours cycle through the palette; explicit colours win", async () => {
    const { owner, url } = await setup()
    const colors: string[] = []
    for (let i = 0; i < 7; i++) {
      colors.push((await owner.call("POST", url, { name: `tag${i}` })).body.tag.color)
    }
    expect(colors).toEqual(["blue", "orange", "aqua", "violet", "magenta", "gray", "blue"])
    const explicit = await owner.call("POST", url, { name: "pinned", color: "gray" })
    expect(explicit.body.tag.color).toBe("gray")
  })

  test("names are unique per workspace regardless of case", async () => {
    const { t, owner, url } = await setup()
    await owner.call("POST", url, { name: "Bug" })
    const dup = await owner.call("POST", url, { name: "bUG" })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe("CONFLICT")

    // The same name is fine in another workspace.
    const other = await setupProject(t, "other@example.com")
    const ok = await other.owner.call("POST", `/api/workspaces/${other.workspaceId}/tags`, {
      name: "Bug",
    })
    expect(ok.status).toBe(201)
  })

  test("rename and recolour; clashes are 409 but re-casing your own name is fine", async () => {
    const { owner, url } = await setup()
    const a = (await owner.call("POST", url, { name: "Alpha" })).body.tag
    await owner.call("POST", url, { name: "Beta" })

    const renamed = await owner.call("PATCH", `/api/tags/${a.id}`, {
      name: "ALPHA",
      color: "violet",
    })
    expect(renamed.status).toBe(200)
    expect(renamed.body.tag).toEqual({ id: a.id, name: "ALPHA", color: "violet" })

    const clash = await owner.call("PATCH", `/api/tags/${a.id}`, { name: "beta" })
    expect(clash.status).toBe(409)
  })

  test.each([
    ["empty name", { name: "" }],
    ["long name", { name: "x".repeat(41) }],
    ["unknown colour", { name: "ok", color: "red" }],
  ])("rejects %s", async (_l, payload) => {
    const { owner, url } = await setup()
    const res = await owner.call("POST", url, payload)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })

  test("any workspace member can manage tags", async () => {
    const { t, workspaceId, url } = await setup()
    const member = await signIn(t.app, "mem@example.com")
    await addMember(t, workspaceId, "mem@example.com")
    const created = await member.call("POST", url, { name: "Shared" })
    expect(created.status).toBe(201)
    expect(
      (await member.call("PATCH", `/api/tags/${created.body.tag.id}`, { name: "Renamed" })).status,
    ).toBe(200)
    expect((await member.call("DELETE", `/api/tags/${created.body.tag.id}`)).status).toBe(204)
  })

  test("every tag route is 404 for outsiders", async () => {
    const { t, owner, url } = await setup()
    const tag = (await owner.call("POST", url, { name: "Private" })).body.tag
    const outsider = await signIn(t.app, "out@example.com")
    const calls: [string, string, unknown?][] = [
      ["GET", url],
      ["POST", url, { name: "Sneaky" }],
      ["PATCH", `/api/tags/${tag.id}`, { name: "Sneaky" }],
      ["DELETE", `/api/tags/${tag.id}`],
    ]
    for (const [method, path, body] of calls) {
      expect([method, path, (await outsider.call(method, path, body)).status]).toEqual([
        method,
        path,
        404,
      ])
    }
    expect((await owner.call("GET", url)).body.tags).toHaveLength(1)
  })

  test("deleting a tag removes it from tasks but leaves the tasks", async () => {
    const { owner, project, url } = await setup()
    const bug = (await owner.call("POST", url, { name: "bug" })).body.tag
    const ux = (await owner.call("POST", url, { name: "ux" })).body.tag
    const task = (
      await owner.call("POST", `/api/projects/${project.id}/tasks`, {
        title: "Tagged",
        tagIds: [bug.id, ux.id],
      })
    ).body.task
    expect(task.tags).toHaveLength(2)

    expect((await owner.call("DELETE", `/api/tags/${bug.id}`)).status).toBe(204)

    const after = await owner.call("GET", `/api/tasks/${task.id}`)
    expect(after.body.task.tags.map((x: { name: string }) => x.name)).toEqual(["ux"])
    expect((await owner.call("GET", url)).body.tags.map((x: { name: string }) => x.name)).toEqual([
      "ux",
    ])
    // The deleted tag can no longer be attached.
    const reuse = await owner.call("PATCH", `/api/tasks/${task.id}`, { tagIds: [bug.id] })
    expect(reuse.status).toBe(400)
  })

  test("unknown tag ids are 404", async () => {
    const { owner } = await setup()
    expect((await owner.call("PATCH", "/api/tags/nope", { name: "x" })).status).toBe(404)
    expect((await owner.call("DELETE", "/api/tags/nope")).status).toBe(404)
  })
})

describe("tag name uniqueness is enforced by the database", () => {
  test("simultaneous creates differing only by case give one tag and one conflict", async () => {
    const { owner, url } = await setup()
    const results = await Promise.all([
      owner.call("POST", url, { name: "Race" }),
      owner.call("POST", url, { name: "rACE" }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect((await owner.call("GET", url)).body.tags).toHaveLength(1)
  })

  test("the index rejects a case-variant duplicate even when inserted directly", async () => {
    const { t, workspaceId } = await setup()
    const insert = (name: string) =>
      t.db
        .insertInto("tags")
        .values({ id: crypto.randomUUID(), workspaceId, name, color: "blue", createdAt: "x" })
        .execute()
    await insert("Bug")
    await expect(insert("bUG")).rejects.toThrow()
  })

  test("renaming onto an existing name (any case) is a conflict", async () => {
    const { owner, url } = await setup()
    await owner.call("POST", url, { name: "Alpha" })
    const beta = (await owner.call("POST", url, { name: "Beta" })).body.tag
    const res = await owner.call("PATCH", `/api/tags/${beta.id}`, { name: "ALPHA" })
    expect(res.status).toBe(409)
  })
})
