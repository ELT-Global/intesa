import { describe, expect, test } from "bun:test"
import { newId, now } from "../src/db"
import { createTestApp, signIn } from "./helpers"

describe("workspaces", () => {
  test("requires a session", async () => {
    const { app } = await createTestApp()
    expect((await app.request("/api/workspaces")).status).toBe(401)
  })

  test("creating a workspace makes the creator its owner and derives the slug", async () => {
    const { app } = await createTestApp()
    const me = await signIn(app, "owner@example.com")
    const res = await me.call("POST", "/api/workspaces", { name: "  Acme Robotics! " })
    expect(res.status).toBe(201)
    expect(res.body.workspace).toMatchObject({
      name: "Acme Robotics!",
      slug: "acme-robotics",
      role: "owner",
    })
    const fetched = await me.call("GET", `/api/workspaces/${res.body.workspace.id}`)
    expect(fetched.body.workspace).toEqual(res.body.workspace)
  })

  test("lists only the caller's workspaces, sorted by name", async () => {
    const { app } = await createTestApp()
    const a = await signIn(app, "a@example.com")
    const b = await signIn(app, "b@example.com")
    await a.call("POST", "/api/workspaces", { name: "Zeta", slug: "zeta-a" })
    await a.call("POST", "/api/workspaces", { name: "Alpha", slug: "alpha-a" })
    await b.call("POST", "/api/workspaces", { name: "Secret", slug: "secret-b" })

    const list = await a.call("GET", "/api/workspaces")
    expect(list.body.workspaces.map((w: { name: string }) => w.name)).toEqual(["Alpha", "Zeta"])
  })

  test("a non-member gets 404 rather than 403, for reads and writes", async () => {
    const { app } = await createTestApp()
    const owner = await signIn(app, "own@example.com")
    const stranger = await signIn(app, "stranger@example.com")
    const { body } = await owner.call("POST", "/api/workspaces", { name: "Private" })
    const id = body.workspace.id

    const get = await stranger.call("GET", `/api/workspaces/${id}`)
    expect(get.status).toBe(404)
    expect(get.body.code).toBe("NOT_FOUND")
    expect((await stranger.call("PATCH", `/api/workspaces/${id}`, { name: "Mine" })).status).toBe(
      404,
    )
  })

  test("members can read but not rename; owners can", async () => {
    const { app, db } = await createTestApp()
    const owner = await signIn(app, "boss@example.com")
    const member = await signIn(app, "worker@example.com")
    const { body } = await owner.call("POST", "/api/workspaces", { name: "Team" })
    const id = body.workspace.id

    const user = await db
      .selectFrom("users")
      .select("id")
      .where("email", "=", "worker@example.com")
      .executeTakeFirstOrThrow()
    await db
      .insertInto("workspaceMembers")
      .values({ id: newId(), workspaceId: id, userId: user.id, role: "member", createdAt: now() })
      .execute()

    const read = await member.call("GET", `/api/workspaces/${id}`)
    expect(read.body.workspace.role).toBe("member")

    const denied = await member.call("PATCH", `/api/workspaces/${id}`, { name: "Hijacked" })
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe("FORBIDDEN")

    const ok = await owner.call("PATCH", `/api/workspaces/${id}`, { name: "Renamed" })
    expect(ok.status).toBe(200)
    expect(ok.body.workspace).toMatchObject({ id, name: "Renamed", slug: "team", role: "owner" })
  })

  test("a taken slug is a conflict, whether given or derived", async () => {
    const { app } = await createTestApp()
    const a = await signIn(app, "s1@example.com")
    const b = await signIn(app, "s2@example.com")
    expect((await a.call("POST", "/api/workspaces", { name: "Same Name" })).status).toBe(201)

    const derived = await b.call("POST", "/api/workspaces", { name: "Same Name" })
    expect(derived.status).toBe(409)
    expect(derived.body.code).toBe("CONFLICT")

    const explicit = await b.call("POST", "/api/workspaces", { name: "Other", slug: "same-name" })
    expect(explicit.status).toBe(409)
  })

  test.each([
    ["empty name", { name: "" }],
    ["blank name", { name: "   " }],
    ["missing name", {}],
    ["name too long", { name: "x".repeat(81) }],
    ["slug with uppercase", { name: "Ok", slug: "Bad" }],
    ["slug too short", { name: "Ok", slug: "a" }],
    ["slug too long", { name: "Ok", slug: "a".repeat(41) }],
    ["name with no slug-able characters", { name: "!!!" }],
  ])("rejects %s with a 400", async (_label, payload) => {
    const { app } = await createTestApp()
    const me = await signIn(app, "v@example.com")
    const res = await me.call("POST", "/api/workspaces", payload)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
    expect(typeof res.body.message).toBe("string")
  })

  test("rejects an invalid rename", async () => {
    const { app } = await createTestApp()
    const me = await signIn(app, "r@example.com")
    const { body } = await me.call("POST", "/api/workspaces", { name: "Valid" })
    const res = await me.call("PATCH", `/api/workspaces/${body.workspace.id}`, { name: "" })
    expect(res.status).toBe(400)
  })
})
