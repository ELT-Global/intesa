import { describe, expect, test } from "bun:test"
import { findOrCreateUser } from "../src/auth/users"
import { addMember, createTestApp, setupProject, signIn, userId } from "./helpers"

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

async function setup() {
  const t = await createTestApp()
  const ctx = await setupProject(t, "owner@example.com")
  const member = await signIn(t.app, "mem@example.com", "Mem")
  await addMember(t, ctx.workspaceId, "mem@example.com")
  const members = await ctx.owner.call("GET", `/api/workspaces/${ctx.workspaceId}/members`)
  const memberId = (email: string) =>
    members.body.members.find((m: { email: string }) => m.email === email).id as string
  const createTask = async (body: Record<string, unknown>, project = ctx.project.id) =>
    (await ctx.owner.call("POST", `/api/projects/${project}/tasks`, body)).body.task as {
      id: string
    }
  return { t, ...ctx, member, memberId, createTask, url: `/api/workspaces/${ctx.workspaceId}` }
}

describe("members", () => {
  test("any member can list members with their roles; outsiders get 404", async () => {
    const { t, member, url } = await setup()
    const res = await member.call("GET", `${url}/members`)
    expect(res.status).toBe(200)
    expect(res.body.members).toHaveLength(2)
    expect(res.body.members.map((m: { email: string; role: string }) => [m.email, m.role])).toEqual(
      [
        ["mem@example.com", "member"],
        ["owner@example.com", "owner"],
      ],
    )
    expect(res.body.members[0]).toMatchObject({ name: "Mem", avatarUrl: null })
    expect(typeof res.body.members[0].userId).toBe("string")

    const outsider = await signIn(t.app, "out@example.com")
    expect((await outsider.call("GET", `${url}/members`)).status).toBe(404)
  })

  test("owner adds a known user by email; duplicates conflict", async () => {
    const { t, owner, url } = await setup()
    await signIn(t.app, "known@example.com", "Known")
    const res = await owner.call("POST", `${url}/members`, { email: " Known@Example.com " })
    expect(res.status).toBe(201)
    expect(res.body.member).toMatchObject({
      email: "known@example.com",
      name: "Known",
      role: "member",
    })
    const dup = await owner.call("POST", `${url}/members`, { email: "known@example.com" })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe("CONFLICT")
  })

  test("an unknown email gets a placeholder account that can already be assigned work", async () => {
    const { t, owner, createTask, url } = await setup()
    const res = await owner.call("POST", `${url}/members`, {
      email: "newbie@example.com",
      role: "owner",
    })
    expect(res.status).toBe(201)
    expect(res.body.member).toMatchObject({ name: "newbie", role: "owner" })
    const user = await t.db
      .selectFrom("users")
      .selectAll()
      .where("email", "=", "newbie@example.com")
      .executeTakeFirstOrThrow()
    expect(user.googleSub).toBeNull()

    const task = await createTask({ title: "x", assigneeIds: [user.id] })
    const got = await owner.call("GET", `/api/tasks/${task.id}`)
    expect(got.body.task.assignees[0].id).toBe(user.id)
  })

  test("first Google sign-in links the placeholder by email, keeping memberships", async () => {
    const { t, owner, url } = await setup()
    const added = await owner.call("POST", `${url}/members`, { email: "later@example.com" })

    const linked = await findOrCreateUser(t.db, {
      email: "Later@Example.com",
      name: "Later Person",
      avatarUrl: "https://example.com/a.png",
      googleSub: "google-sub-1",
    })
    expect(linked.id).toBe(added.body.member.userId)
    expect(linked).toMatchObject({
      googleSub: "google-sub-1",
      name: "Later Person",
      avatarUrl: "https://example.com/a.png",
    })

    // Later sign-ins resolve by sub, even if the email changed on Google's side.
    const again = await findOrCreateUser(t.db, {
      email: "renamed@example.com",
      googleSub: "google-sub-1",
    })
    expect(again.id).toBe(linked.id)

    const members = await owner.call("GET", `${url}/members`)
    expect(
      members.body.members.filter((m: { userId: string }) => m.userId === linked.id),
    ).toHaveLength(1)
  })

  test("a user who already has a name keeps it when linking", async () => {
    const { t } = await setup()
    await signIn(t.app, "named@example.com", "Chosen Name")
    const linked = await findOrCreateUser(t.db, {
      email: "named@example.com",
      name: "Google Name",
      googleSub: "sub-2",
    })
    expect(linked.name).toBe("Chosen Name")
  })

  test("adding members is owner-only (403) and invisible to outsiders (404)", async () => {
    const { t, member, url } = await setup()
    const denied = await member.call("POST", `${url}/members`, { email: "x@example.com" })
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe("FORBIDDEN")

    const outsider = await signIn(t.app, "out@example.com")
    expect((await outsider.call("POST", `${url}/members`, { email: "x@example.com" })).status).toBe(
      404,
    )
  })

  test("rejects an invalid email or role", async () => {
    const { owner, url } = await setup()
    expect((await owner.call("POST", `${url}/members`, { email: "nope" })).status).toBe(400)
    expect(
      (await owner.call("POST", `${url}/members`, { email: "a@example.com", role: "admin" }))
        .status,
    ).toBe(400)
  })
})

describe("member roles", () => {
  test("owners can promote and demote; members cannot", async () => {
    const { owner, member, memberId, url } = await setup()
    const id = memberId("mem@example.com")

    const denied = await member.call("PATCH", `${url}/members/${id}`, { role: "owner" })
    expect(denied.status).toBe(403)

    const up = await owner.call("PATCH", `${url}/members/${id}`, { role: "owner" })
    expect(up.status).toBe(200)
    expect(up.body.member).toMatchObject({ id, role: "owner" })

    const down = await owner.call("PATCH", `${url}/members/${memberId("owner@example.com")}`, {
      role: "member",
    })
    expect(down.body.member.role).toBe("member")
  })

  test("the last owner cannot be demoted", async () => {
    const { owner, memberId, url } = await setup()
    const res = await owner.call("PATCH", `${url}/members/${memberId("owner@example.com")}`, {
      role: "member",
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe("CONFLICT")
  })

  test("a membership from another workspace is not addressable", async () => {
    const { owner, url, t } = await setup()
    const other = await setupProject(t, "other@example.com")
    const theirs = await other.owner.call("GET", `/api/workspaces/${other.workspaceId}/members`)
    const res = await owner.call("PATCH", `${url}/members/${theirs.body.members[0].id}`, {
      role: "member",
    })
    expect(res.status).toBe(404)
  })

  test("rejects an invalid role", async () => {
    const { owner, memberId, url } = await setup()
    const res = await owner.call("PATCH", `${url}/members/${memberId("mem@example.com")}`, {
      role: "boss",
    })
    expect(res.status).toBe(400)
  })
})

describe("removing members", () => {
  test("an owner removes a member, who then loses all access", async () => {
    const { owner, member, memberId, project, url } = await setup()
    expect((await member.call("GET", `/api/projects/${project.id}`)).status).toBe(200)

    const res = await owner.call("DELETE", `${url}/members/${memberId("mem@example.com")}`)
    expect(res.status).toBe(204)

    expect((await member.call("GET", url)).status).toBe(404)
    expect((await member.call("GET", `/api/projects/${project.id}`)).status).toBe(404)
    expect((await member.call("GET", "/api/workspaces")).body.workspaces).toEqual([])
  })

  test("a member can leave but cannot remove others", async () => {
    const { owner, member, memberId, url } = await setup()
    const denied = await member.call("DELETE", `${url}/members/${memberId("owner@example.com")}`)
    expect(denied.status).toBe(403)

    const left = await member.call("DELETE", `${url}/members/${memberId("mem@example.com")}`)
    expect(left.status).toBe(204)
    const members = await owner.call("GET", `${url}/members`)
    expect(members.body.members).toHaveLength(1)
  })

  test("the last owner cannot leave or be removed; with a second owner they can", async () => {
    const { owner, memberId, url } = await setup()
    const ownerMemberId = memberId("owner@example.com")
    const blocked = await owner.call("DELETE", `${url}/members/${ownerMemberId}`)
    expect(blocked.status).toBe(409)

    await owner.call("PATCH", `${url}/members/${memberId("mem@example.com")}`, { role: "owner" })
    expect((await owner.call("DELETE", `${url}/members/${ownerMemberId}`)).status).toBe(204)
  })

  test("removal clears their assignments in this workspace only", async () => {
    const { t, owner, workspaceId, memberId, createTask, project, url } = await setup()
    const memId = await userId(t, "mem@example.com")
    const here = await createTask({ title: "here", assigneeIds: [memId] })

    // Same person in a second workspace keeps their work there.
    const other = await setupProject(t, "second-owner@example.com")
    await addMember(t, other.workspaceId, "mem@example.com")
    const there = await other.owner.call("POST", `/api/projects/${other.project.id}/tasks`, {
      title: "there",
      assigneeIds: [memId],
    })

    await owner.call("DELETE", `${url}/members/${memberId("mem@example.com")}`)

    const after = await owner.call("GET", `/api/tasks/${here.id}`)
    expect(after.body.task.assignees).toEqual([])
    const kept = await other.owner.call("GET", `/api/tasks/${there.body.task.id}`)
    expect(kept.body.task.assignees.map((a: { id: string }) => a.id)).toEqual([memId])
    void workspaceId
    void project
  })

  test("outsiders get 404 and unknown member ids get 404", async () => {
    const { t, owner, memberId, url } = await setup()
    const outsider = await signIn(t.app, "out@example.com")
    expect(
      (await outsider.call("DELETE", `${url}/members/${memberId("mem@example.com")}`)).status,
    ).toBe(404)
    expect((await owner.call("DELETE", `${url}/members/nope`)).status).toBe(404)
  })
})

describe("my tasks", () => {
  test("returns only the caller's tasks in this workspace, subtasks included, with project refs", async () => {
    const { t, owner, member, workspaceId, project, createTask, url } = await setup()
    const memId = await userId(t, "mem@example.com")
    const ownerId = await userId(t, "owner@example.com")

    const parent = await createTask({ title: "parent", assigneeIds: [ownerId] })
    await createTask({ title: "mine-sub", parentTaskId: parent.id, assigneeIds: [memId] })
    await createTask({ title: "mine-top", assigneeIds: [memId] })
    await createTask({ title: "theirs", assigneeIds: [ownerId] })
    await createTask({ title: "unassigned" })

    const second = await owner.call("POST", `${url}/projects`, { name: "Second Project" })
    const inSecond = await createTask(
      { title: "mine-second", assigneeIds: [memId] },
      second.body.project.id,
    )
    void inSecond

    // Work in another workspace never shows up here.
    const other = await setupProject(t, "other@example.com")
    await addMember(t, other.workspaceId, "mem@example.com")
    await other.owner.call("POST", `/api/projects/${other.project.id}/tasks`, {
      title: "elsewhere",
      assigneeIds: [memId],
    })

    const res = await member.call("GET", `${url}/my-tasks`)
    expect(res.status).toBe(200)
    const titles = res.body.tasks.map((x: { title: string }) => x.title).sort()
    expect(titles).toEqual(["mine-second", "mine-sub", "mine-top"])
    const sub = res.body.tasks.find((x: { title: string }) => x.title === "mine-sub")
    expect(sub).toMatchObject({
      parentTaskId: parent.id,
      project: { id: project.id, name: "Website", key: project.key },
      assignees: [{ id: memId }],
    })
    void workspaceId
  })

  test("is 404 for outsiders", async () => {
    const { t, url } = await setup()
    const outsider = await signIn(t.app, "out@example.com")
    expect((await outsider.call("GET", `${url}/my-tasks`)).status).toBe(404)
    expect((await outsider.call("GET", `${url}/home`)).status).toBe(404)
  })
})

describe("home", () => {
  test("lists the five most recently updated projects", async () => {
    const { owner, url } = await setup()
    for (let i = 1; i <= 6; i++) {
      await owner.call("POST", `${url}/projects`, { name: `Proj ${i}`, key: `P${i}X` })
    }
    const res = await owner.call("GET", `${url}/home`)
    expect(res.body.projects).toHaveLength(5)
    expect(res.body.projects[0].name).toBe("Proj 6")
    expect(res.body.projects.map((p: { name: string }) => p.name)).not.toContain("Website")
  })

  test("assigned excludes completed work and is capped at ten", async () => {
    const { t, owner, member, createTask, url } = await setup()
    const memId = await userId(t, "mem@example.com")
    const done = await createTask({ title: "done", assigneeIds: [memId] })
    await owner.call("PATCH", `/api/tasks/${done.id}`, { status: "complete" })
    for (let i = 0; i < 11; i++) await createTask({ title: `t${i}`, assigneeIds: [memId] })

    const res = await member.call("GET", `${url}/home`)
    expect(res.body.assigned).toHaveLength(10)
    expect(res.body.assigned.map((x: { title: string }) => x.title)).not.toContain("done")
    expect(res.body.assigned[0].project.key).toBeDefined()
  })

  test("dueSoon includes overdue and next-week tasks, excludes complete, far and undated ones", async () => {
    const { owner, createTask, url } = await setup()
    await createTask({ title: "overdue", dueAt: day(-3) })
    await createTask({ title: "today", dueAt: day(0) })
    await createTask({ title: "in-a-week", dueAt: day(6) })
    await createTask({ title: "later", dueAt: day(30) })
    await createTask({ title: "undated" })
    const finished = await createTask({ title: "finished-overdue", dueAt: day(-1) })
    await owner.call("PATCH", `/api/tasks/${finished.id}`, { status: "complete" })

    const res = await owner.call("GET", `${url}/home`)
    expect(res.body.dueSoon.map((x: { title: string }) => x.title)).toEqual([
      "overdue",
      "today",
      "in-a-week",
    ])
    expect(res.body.dueSoon[0].project).toMatchObject({ name: "Website" })
  })
})

describe("member races", () => {
  test("two simultaneous adds of the same person give one member and one conflict", async () => {
    const { t, owner, url } = await setup()
    await signIn(t.app, "twice@example.com")
    const results = await Promise.all([
      owner.call("POST", `${url}/members`, { email: "twice@example.com" }),
      owner.call("POST", `${url}/members`, { email: "twice@example.com" }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    const members = await owner.call("GET", `${url}/members`)
    expect(
      members.body.members.filter((m: { email: string }) => m.email === "twice@example.com"),
    ).toHaveLength(1)
  })
})

describe("home and my tasks details", () => {
  test("dueSoon uses the client's date when ?today is given", async () => {
    const { owner, createTask, url } = await setup()
    await createTask({ title: "soon-for-a-traveller", dueAt: day(20) })
    await createTask({ title: "never", dueAt: day(40) })

    const normal = await owner.call("GET", `${url}/home`)
    expect(normal.body.dueSoon).toEqual([])

    const ahead = await owner.call("GET", `${url}/home?today=${day(15)}`)
    expect(ahead.body.dueSoon.map((x: { title: string }) => x.title)).toEqual([
      "soon-for-a-traveller",
    ])
  })

  test("rejects a malformed or impossible ?today", async () => {
    const { owner, url } = await setup()
    for (const bad of ["tomorrow", "2026-02-31", "2026-1-1"]) {
      const res = await owner.call("GET", `${url}/home?today=${bad}`)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe("VALIDATION_ERROR")
    }
  })

  test("dueSoon is ordered soonest first and my-tasks most recently updated first", async () => {
    const { t, owner, createTask, url } = await setup()
    const me = await userId(t, "owner@example.com")
    const later = await createTask({ title: "later", dueAt: day(5), assigneeIds: [me] })
    await createTask({ title: "sooner", dueAt: day(1), assigneeIds: [me] })
    await createTask({ title: "overdue", dueAt: day(-2), assigneeIds: [me] })

    const home = await owner.call("GET", `${url}/home`)
    expect(home.body.dueSoon.map((x: { title: string }) => x.title)).toEqual([
      "overdue",
      "sooner",
      "later",
    ])

    await owner.call("PATCH", `/api/tasks/${later.id}`, { title: "later (edited)" })
    const mine = await owner.call("GET", `${url}/my-tasks`)
    expect(mine.body.tasks[0].title).toBe("later (edited)")
  })
})
