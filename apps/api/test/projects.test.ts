import { describe, expect, test } from "bun:test"
import { deriveKeyBase } from "../src/projects/service"
import { addMember, createTestApp, setupProject, signIn } from "./helpers"

describe("project key derivation", () => {
  test.each([
    ["Website Redesign", "WR"],
    ["Mobile App Launch", "MAL"],
    ["Marketing", "MAR"],
    ["!!!", "PRJ"],
    ["123 Go", "GO"],
    ["Very Long Project Name Here Now", "VLPNH"],
  ])("%s -> %s", (name, key) => {
    expect(deriveKeyBase(name)).toBe(key)
  })
})

describe("projects", () => {
  test("create derives a key, lists by name, and returns the full shape", async () => {
    const t = await createTestApp()
    const { owner, workspaceId } = await setupProject(t, "o@example.com", "Zeta Site")
    const created = await owner.call("POST", `/api/workspaces/${workspaceId}/projects`, {
      name: "Alpha App",
      description: "  First one ",
    })
    expect(created.status).toBe(201)
    expect(created.body.project).toMatchObject({
      workspaceId,
      name: "Alpha App",
      key: "AA",
      description: "First one",
    })

    const list = await owner.call("GET", `/api/workspaces/${workspaceId}/projects`)
    expect(list.body.projects.map((p: { name: string }) => p.name)).toEqual([
      "Alpha App",
      "Zeta Site",
    ])
  })

  test("derived keys are suffixed to stay unique; explicit duplicates conflict", async () => {
    const t = await createTestApp()
    const { owner, workspaceId } = await setupProject(t, "k@example.com", "Web Site")
    const url = `/api/workspaces/${workspaceId}/projects`
    const second = await owner.call("POST", url, { name: "Wide Sky" })
    expect(second.body.project.key).toBe("WS2")
    const third = await owner.call("POST", url, { name: "Wild Sea" })
    expect(third.body.project.key).toBe("WS3")

    const dup = await owner.call("POST", url, { name: "Other", key: "WS" })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe("CONFLICT")
  })

  test("simultaneous creates never share a key", async () => {
    const t = await createTestApp()
    const { owner, workspaceId } = await setupProject(t, "race@example.com", "Zebra Crossing")
    const url = `/api/workspaces/${workspaceId}/projects`
    const derived = await Promise.all(
      [1, 2, 3, 4].map(() => owner.call("POST", url, { name: "Zed Zone" })),
    )
    expect(derived.every((r) => r.status === 201)).toBe(true)
    const keys = derived.map((r) => r.body.project.key)
    expect(new Set(keys).size).toBe(4)

    const explicit = await Promise.all(
      [1, 2, 3].map((i) => owner.call("POST", url, { name: `Same ${i}`, key: "SAME" })),
    )
    expect(explicit.map((r) => r.status).sort()).toEqual([201, 409, 409])
  })

  test("the same key can exist in different workspaces", async () => {
    const t = await createTestApp()
    const a = await setupProject(t, "a@example.com", "Web Site")
    const b = await setupProject(t, "b@example.com", "Web Site")
    expect(a.project.key).toBe(b.project.key)
  })

  test.each([
    ["lowercase key", { name: "X", key: "ab" }],
    ["key starting with a digit", { name: "X", key: "1AB" }],
    ["key too short", { name: "X", key: "A" }],
    ["key too long", { name: "X", key: "ABCDEF" }],
    ["empty name", { name: " " }],
  ])("rejects %s", async (_l, payload) => {
    const t = await createTestApp()
    const { owner, workspaceId } = await setupProject(t, "v@example.com")
    const res = await owner.call("POST", `/api/workspaces/${workspaceId}/projects`, payload)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })

  test("PATCH updates name and description but never the key", async () => {
    const t = await createTestApp()
    const { owner, project } = await setupProject(t, "p@example.com")
    const res = await owner.call("PATCH", `/api/projects/${project.id}`, {
      name: "Renamed",
      description: "About",
      key: "ZZZ",
    })
    expect(res.status).toBe(200)
    expect(res.body.project).toMatchObject({
      name: "Renamed",
      description: "About",
      key: project.key,
    })

    const cleared = await owner.call("PATCH", `/api/projects/${project.id}`, { description: null })
    expect(cleared.body.project.description).toBeNull()
    expect((await owner.call("PATCH", `/api/projects/${project.id}`, { name: "" })).status).toBe(
      400,
    )
  })

  test("a plain member can read and edit but only an owner can delete", async () => {
    const t = await createTestApp()
    const { owner, workspaceId, project } = await setupProject(t, "boss@example.com")
    const member = await signIn(t.app, "mem@example.com")
    await addMember(t, workspaceId, "mem@example.com")

    expect((await member.call("GET", `/api/projects/${project.id}`)).status).toBe(200)
    expect((await member.call("PATCH", `/api/projects/${project.id}`, { name: "Ok" })).status).toBe(
      200,
    )
    const denied = await member.call("DELETE", `/api/projects/${project.id}`)
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe("FORBIDDEN")

    expect((await owner.call("DELETE", `/api/projects/${project.id}`)).status).toBe(204)
    expect((await owner.call("GET", `/api/projects/${project.id}`)).status).toBe(404)
  })

  test("deleting a project removes its tasks", async () => {
    const t = await createTestApp()
    const { owner, project } = await setupProject(t, "del@example.com")
    const task = await owner.call("POST", `/api/projects/${project.id}/tasks`, { title: "T" })
    await owner.call("DELETE", `/api/projects/${project.id}`)
    expect((await owner.call("GET", `/api/tasks/${task.body.task.id}`)).status).toBe(404)
  })

  test("every project route is 404 for someone outside the workspace", async () => {
    const t = await createTestApp()
    const { owner, workspaceId, project } = await setupProject(t, "own@example.com")
    const outsider = await signIn(t.app, "out@example.com")
    const calls: [string, string, unknown?][] = [
      ["GET", `/api/workspaces/${workspaceId}/projects`],
      ["POST", `/api/workspaces/${workspaceId}/projects`, { name: "Sneaky" }],
      ["GET", `/api/projects/${project.id}`],
      ["PATCH", `/api/projects/${project.id}`, { name: "Sneaky" }],
      ["DELETE", `/api/projects/${project.id}`],
      ["GET", `/api/projects/${project.id}/tasks`],
      ["POST", `/api/projects/${project.id}/tasks`, { title: "Sneaky" }],
    ]
    for (const [method, path, body] of calls) {
      const res = await outsider.call(method, path, body)
      expect([method, path, res.status]).toEqual([method, path, 404])
      expect(res.body.code).toBe("NOT_FOUND")
    }
    // Nothing leaked or changed.
    const still = await owner.call("GET", `/api/projects/${project.id}`)
    expect(still.body.project.name).toBe("Website")
  })

  test("unknown project ids are 404", async () => {
    const t = await createTestApp()
    const me = await signIn(t.app, "x@example.com")
    expect((await me.call("GET", "/api/projects/nope")).status).toBe(404)
  })
})
