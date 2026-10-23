import { describe, expect, test } from "bun:test"
import { DAY_MS } from "../src/db"
import type { Status } from "../src/tasks/schemas"
import { loadWeekLog, type WeekLog, type WeekTask } from "../src/tasks/week"
import { addMember, createTestApp, setupProject, signIn, userId } from "./helpers"

// The week under test: Monday 2 March 2026 to Monday 9 March, in UTC.
const FROM = "2026-03-02T00:00:00.000Z"
const TO = "2026-03-09T00:00:00.000Z"
// Noon on the given day of March 2026 (0 and below reach back into February).
const d = (day: number, hour = 12) => new Date(Date.UTC(2026, 2, day, hour)).toISOString()

// What happened to a task, written straight to the database so it can lie in the past.
type Story = {
  created: string
  // [status, at]; the first is the status it was created with.
  statuses: [Status, string][]
  // [userId, assignedAt, unassignedAt?]
  assigned: [string, string, string?][]
  // Who reviewed / tested it (null for nobody); left out means unanswered.
  reviewedBy?: string | null
  testedBy?: string | null
}

async function setup() {
  const t = await createTestApp()
  const ctx = await setupProject(t, "owner@example.com")
  const ownerId = await userId(t, "owner@example.com")
  const url = `/api/workspaces/${ctx.workspaceId}`

  const person = async (email: string, name: string) => {
    await signIn(t.app, email, name)
    return addMember(t, ctx.workspaceId, email)
  }

  const task = async (story: Story, projectId = ctx.project.id, title = "Task") => {
    const res = await ctx.owner.call("POST", `/api/projects/${projectId}/tasks`, { title })
    expect(res.status).toBe(201)
    const id = res.body.task.id as string
    await t.db.deleteFrom("taskStatusHistory").where("taskId", "=", id).execute()
    await t.db.deleteFrom("taskAssignments").where("taskId", "=", id).execute()
    await t.db.deleteFrom("taskAssignees").where("taskId", "=", id).execute()

    const last = story.statuses.at(-1)?.[0] ?? "todo"
    await t.db
      .updateTable("tasks")
      .set({
        createdAt: story.created,
        status: last,
        ...(story.reviewedBy !== undefined && { reviewedBy: story.reviewedBy, reviewedBySet: 1 }),
        ...(story.testedBy !== undefined && { testedBy: story.testedBy, testedBySet: 1 }),
      })
      .where("id", "=", id)
      .execute()
    await t.db
      .insertInto("taskStatusHistory")
      .values(
        story.statuses.map(([status, at], i) => ({
          id: crypto.randomUUID(),
          taskId: id,
          fromStatus: story.statuses[i - 1]?.[0] ?? null,
          toStatus: status,
          updatedAt: at,
          updatedBy: ownerId,
        })),
      )
      .execute()
    if (story.assigned.length > 0) {
      await t.db
        .insertInto("taskAssignments")
        .values(
          story.assigned.map(([userId, assignedAt, unassignedAt]) => ({
            id: crypto.randomUUID(),
            taskId: id,
            userId,
            assignedAt,
            unassignedAt: unassignedAt ?? null,
          })),
        )
        .execute()
    }
    const current = new Set(story.assigned.filter((a) => !a[2]).map((a) => a[0]))
    if (current.size > 0) {
      await t.db
        .insertInto("taskAssignees")
        .values([...current].map((userId) => ({ taskId: id, userId })))
        .execute()
    }
    return { id, key: res.body.task.key as string }
  }

  const week = (from = FROM, to = TO, client = ctx.owner) =>
    client.call("GET", `${url}/week?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)

  const tasksOf = (body: WeekLog, id: string) => body.people.find((p) => p.user.id === id)?.tasks
  // The person's one task that week.
  const onlyTask = (body: WeekLog, id: string) => {
    const tasks = tasksOf(body, id) ?? []
    expect(tasks).toHaveLength(1)
    return tasks[0] as WeekTask
  }

  const checksOf = (body: WeekLog, id: string) => body.people.find((p) => p.user.id === id)?.checks

  return { t, ...ctx, ownerId, url, person, task, week, tasksOf, onlyTask, checksOf }
}

describe("weekly log access and validation", () => {
  test("is 404 for someone outside the workspace", async () => {
    const { t, week } = await setup()
    const outsider = await signIn(t.app, "out@example.com")
    const res = await week(FROM, TO, outsider)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe("NOT_FOUND")
  })

  test.each([
    ["missing from", { to: TO }],
    ["missing to", { from: FROM }],
    ["a bare date", { from: "2026-03-02", to: TO }],
    ["no offset", { from: "2026-03-02T00:00:00", to: TO }],
    ["an impossible date", { from: "2026-02-31T00:00:00Z", to: TO }],
    ["nonsense", { from: "monday", to: TO }],
    ["to equal to from", { from: FROM, to: FROM }],
    ["to before from", { from: TO, to: FROM }],
    ["more than 8 days", { from: FROM, to: "2026-03-10T00:00:00.001Z" }],
  ])("rejects %s", async (_label, query) => {
    const { owner, url } = await setup()
    const qs = new URLSearchParams(query as Record<string, string>).toString()
    const res = await owner.call("GET", `${url}/week?${qs}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("VALIDATION_ERROR")
  })

  test("accepts offsets and a week stretched by a DST change, echoing UTC instants", async () => {
    const { week } = await setup()
    const res = await week("2026-03-02T00:00:00+01:00", "2026-03-09T00:00:00+02:00")
    expect(res.status).toBe(200)
    expect(res.body.from).toBe("2026-03-01T23:00:00.000Z")
    expect(res.body.to).toBe("2026-03-08T22:00:00.000Z")
    expect((await week(FROM, "2026-03-10T00:00:00Z")).status).toBe(200)
  })
})

describe("weekly log people", () => {
  test("lists every member, with no tasks as [], ordered by name ignoring case then id", async () => {
    const { t, person, week, ownerId } = await setup()
    const carl = await person("carl@example.com", "carl")
    const ada = await person("ada@example.com", "Ada")
    const sam1 = await person("sam1@example.com", "Sam")
    const sam2 = await person("sam2@example.com", "Sam")

    // Someone else's workspace is not involved.
    await setupProject(t, "other@example.com")

    const res = await week()
    expect(res.status).toBe(200)
    const sams = [sam1, sam2].sort()
    expect(res.body.people.map((p: { user: { id: string } }) => p.user.id)).toEqual([
      ada,
      carl,
      ownerId,
      ...sams,
    ])
    expect(res.body.people[0]).toEqual({
      user: { id: ada, name: "Ada", avatarUrl: null },
      member: true,
      tasks: [],
      checks: [],
    })
    const otherOwner = await userId(t, "other@example.com")
    expect(res.body.people.some((p: { user: { id: string } }) => p.user.id === otherOwner)).toBe(
      false,
    )
  })

  test("a removed member still shows the work they had, as not a member", async () => {
    const { owner, url, project, person, week, onlyTask } = await setup()
    const bea = await person("bea@example.com", "Bea")
    const created = await owner.call("POST", `/api/projects/${project.id}/tasks`, {
      title: "Hers",
      assigneeIds: [bea],
    })
    expect(created.status).toBe(201)
    const members = await owner.call("GET", `${url}/members`)
    const memberId = members.body.members.find((m: { userId: string }) => m.userId === bea).id
    expect((await owner.call("DELETE", `${url}/members/${memberId}`)).status).toBe(204)

    const now = Date.now()
    const res = await week(
      new Date(now - DAY_MS).toISOString(),
      new Date(now + DAY_MS).toISOString(),
    )
    const entry = res.body.people.find((p: { user: { id: string } }) => p.user.id === bea)
    expect(entry).toMatchObject({ user: { id: bea, name: "Bea" }, member: false })
    const task = onlyTask(res.body, bea)
    expect(task).toMatchObject({ title: "Hers", carriedOver: false, startStatus: null })
    expect(String(task.unassignedAt) >= task.assignedAt).toBe(true)
  })

  test("someone who left with nothing that week is not listed", async () => {
    const { owner, url, person, week } = await setup()
    const bea = await person("bea@example.com", "Bea")
    const members = await owner.call("GET", `${url}/members`)
    const memberId = members.body.members.find((m: { userId: string }) => m.userId === bea).id
    await owner.call("DELETE", `${url}/members/${memberId}`)
    const res = await week()
    expect(res.body.people.some((p: { user: { id: string } }) => p.user.id === bea)).toBe(false)
  })
})

describe("weekly log tasks", () => {
  test("tells carried-over work from work assigned during the week", async () => {
    const { person, task, week, tasksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const old = await task({
      created: d(-10),
      statuses: [["todo", d(-10)]],
      assigned: [[ada, d(-10)]],
    })
    const fresh = await task({ created: d(3), statuses: [["todo", d(3)]], assigned: [[ada, d(3)]] })
    const handed = await task({
      created: d(-10),
      statuses: [["in_progress", d(-10)]],
      assigned: [[ada, d(4)]],
    })
    // Assigned only after the week.
    await task({ created: d(9, 0), statuses: [["todo", d(9, 0)]], assigned: [[ada, TO]] })

    const tasks = tasksOf((await week()).body, ada) ?? []
    const byId = new Map(tasks.map((x) => [x.id, x]))
    expect(tasks).toHaveLength(3)
    expect(byId.get(old.id)).toMatchObject({
      key: old.key,
      status: "todo",
      startStatus: "todo",
      assignedAt: d(-10),
      carriedOver: true,
      unassignedAt: null,
      completedAt: null,
      changes: [],
    })
    expect(byId.get(fresh.id)).toMatchObject({
      status: "todo",
      startStatus: null,
      assignedAt: d(3),
      carriedOver: false,
      createdAt: d(3),
      changes: [{ fromStatus: null, toStatus: "todo", at: d(3) }],
    })
    expect(byId.get(handed.id)).toMatchObject({
      status: "in_progress",
      startStatus: "in_progress",
      assignedAt: d(4),
      carriedOver: false,
    })
  })

  test("dates work from when it left Backlog, and Backlog is never carried over", async () => {
    const { person, task, week, tasksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const parked = await task({
      created: d(-10),
      statuses: [["backlog", d(-10)]],
      assigned: [[ada, d(-10)]],
    })
    const pickedUp = await task({
      created: d(-10),
      statuses: [
        ["backlog", d(-10)],
        ["todo", d(3)],
      ],
      assigned: [[ada, d(-10)]],
    })
    const plannedEarlier = await task({
      created: d(-10),
      statuses: [
        ["backlog", d(-10)],
        ["todo", d(-8)],
      ],
      assigned: [[ada, d(-10)]],
    })
    const assignedLater = await task({
      created: d(-10),
      statuses: [["todo", d(-10)]],
      assigned: [[ada, d(-5)]],
    })
    const shelved = await task({
      created: d(-10),
      statuses: [
        ["todo", d(-10)],
        ["backlog", d(-5)],
      ],
      assigned: [[ada, d(-10)]],
    })

    const byId = new Map(tasksOf((await week()).body, ada)?.map((x) => [x.id, x]))
    expect(byId.get(parked.id)).toMatchObject({
      assignedAt: d(-10),
      plannedAt: null,
      carriedOver: false,
    })
    expect(byId.get(pickedUp.id)).toMatchObject({ plannedAt: d(3), carriedOver: false })
    expect(byId.get(plannedEarlier.id)).toMatchObject({ plannedAt: d(-8), carriedOver: true })
    expect(byId.get(assignedLater.id)).toMatchObject({ plannedAt: d(-5), carriedOver: true })
    expect(byId.get(shelved.id)).toMatchObject({
      startStatus: "backlog",
      plannedAt: d(-10),
      carriedOver: false,
    })
  })

  test("shows subtask progress and the blockers that are still open", async () => {
    const { owner, project, person, task, week, tasksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const story = (status: Status = "todo") => ({
      created: d(-3),
      statuses: [[status, d(-3)]] as [Status, string][],
      assigned: [[ada, d(-3)]] as [string, string][],
    })
    const parent = await task(story())
    const alone = await task(story())
    const open = await task(story())
    const done = await task(story("complete"))
    for (const [title, status] of [
      ["First", "complete"],
      ["Second", "todo"],
      ["Third", "complete"],
      ["Fourth", "in_progress"],
    ] as const) {
      const res = await owner.call("POST", `/api/projects/${project.id}/tasks`, {
        title,
        status,
        parentTaskId: parent.id,
      })
      expect(res.status).toBe(201)
    }
    for (const blocker of [open, done]) {
      const res = await owner.call("POST", `/api/tasks/${blocker.id}/relationships`, {
        type: "blocks",
        taskId: parent.id,
      })
      expect(res.status).toBe(201)
    }

    const byId = new Map(tasksOf((await week()).body, ada)?.map((x) => [x.id, x]))
    expect(byId.get(parent.id)).toMatchObject({
      subtasks: { done: 2, total: 4 },
      blockedBy: [{ id: open.id, key: open.key, title: "Task", status: "todo" }],
    })
    expect(byId.get(alone.id)).toMatchObject({ subtasks: null, blockedBy: [] })
  })

  test("keeps work completed in the week and drops work completed outside it", async () => {
    const { person, task, week, tasksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const story = (statuses: [Status, string][]): Story => ({
      created: d(-10),
      statuses: [["todo", d(-10)], ...statuses],
      assigned: [[ada, d(-10)]],
    })
    const doneIn = await task(story([["complete", d(4)]]))
    await task(story([["complete", d(-3)]]))
    const reopened = await task(
      story([
        ["complete", d(-3)],
        ["todo", d(5)],
      ]),
    )
    const doneAfter = await task(
      story([
        ["in_progress", d(3)],
        ["complete", d(12)],
      ]),
    )
    const doneTwice = await task(
      story([
        ["complete", d(-3)],
        ["in_progress", d(3)],
        ["complete", d(6)],
      ]),
    )

    const tasks = tasksOf((await week()).body, ada) ?? []
    const byId = new Map(tasks.map((x) => [x.id, x]))
    expect(new Set(byId.keys())).toEqual(
      new Set([doneIn.id, reopened.id, doneAfter.id, doneTwice.id]),
    )
    expect(byId.get(doneIn.id)).toMatchObject({
      status: "complete",
      startStatus: "todo",
      completedAt: d(4),
    })
    expect(byId.get(reopened.id)).toMatchObject({
      status: "todo",
      startStatus: "complete",
      completedAt: null,
    })
    expect(byId.get(doneAfter.id)).toMatchObject({
      status: "in_progress",
      startStatus: "todo",
      completedAt: null,
      changes: [{ fromStatus: "todo", toStatus: "in_progress", at: d(3) }],
    })
    expect(byId.get(doneTwice.id)).toMatchObject({
      status: "complete",
      startStatus: "complete",
      completedAt: d(6),
    })
  })

  test("follows assignments: taken off mid-week, handed to someone else, stretches merged", async () => {
    const { person, task, week, tasksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const bea = await person("bea@example.com", "Bea")
    const base = { created: d(-10), statuses: [["todo", d(-10)]] as [Status, string][] }

    const handed = await task({
      ...base,
      assigned: [
        [ada, d(-10), d(4)],
        [bea, d(4)],
      ],
    })
    await task({ ...base, assigned: [[ada, d(-10), d(-2)]] })
    await task({ ...base, assigned: [[ada, d(-10), FROM]] })
    const laterOff = await task({ ...base, assigned: [[ada, d(-10), d(12)]] })
    const gap = await task({
      ...base,
      assigned: [
        [ada, d(-10), d(3)],
        [ada, d(5)],
      ],
    })
    const twice = await task({
      ...base,
      assigned: [
        [ada, d(3), d(4)],
        [ada, d(5), d(6)],
      ],
    })

    const body = (await week()).body
    const adas = tasksOf(body, ada) ?? []
    const byId = new Map(adas.map((x) => [x.id, x]))
    expect(adas).toHaveLength(4)
    expect(byId.get(handed.id)).toMatchObject({
      assignedAt: d(-10),
      carriedOver: true,
      unassignedAt: d(4),
    })
    expect(byId.get(laterOff.id)).toMatchObject({ unassignedAt: null })
    expect(byId.get(gap.id)).toMatchObject({ assignedAt: d(-10), unassignedAt: null })
    expect(byId.get(twice.id)).toMatchObject({
      assignedAt: d(3),
      carriedOver: false,
      unassignedAt: d(6),
    })

    expect(tasksOf(body, bea)).toEqual([
      expect.objectContaining({
        id: handed.id,
        assignedAt: d(4),
        carriedOver: false,
        unassignedAt: null,
      }),
    ])
  })

  test("reassigning through the API moves the work from one person to the other", async () => {
    const { owner, project, person, week, onlyTask } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const bea = await person("bea@example.com", "Bea")
    const created = await owner.call("POST", `/api/projects/${project.id}/tasks`, {
      title: "Shared",
      assigneeIds: [ada],
    })
    const id = created.body.task.id
    await owner.call("PATCH", `/api/tasks/${id}`, { assigneeIds: [ada, bea] })
    await owner.call("PATCH", `/api/tasks/${id}`, { assigneeIds: [bea] })

    const now = Date.now()
    const body = (
      await week(new Date(now - DAY_MS).toISOString(), new Date(now + DAY_MS).toISOString())
    ).body
    const adas = onlyTask(body, ada)
    const beas = onlyTask(body, bea)
    expect(adas.unassignedAt).not.toBeNull()
    expect(beas.unassignedAt).toBeNull()
    expect(beas.assignedAt > adas.assignedAt).toBe(true)
    expect(String(adas.unassignedAt) > beas.assignedAt).toBe(true)
  })

  test("lists the week's status changes oldest first, from inclusive and to exclusive", async () => {
    const { person, task, week, onlyTask, ownerId } = await setup()
    const ada = await person("ada@example.com", "Ada")
    await task({
      created: d(-10),
      statuses: [
        ["todo", d(-10)],
        ["in_progress", FROM],
        ["review", d(5)],
        ["complete", TO],
      ],
      assigned: [[ada, d(-10)]],
    })
    const entry = onlyTask((await week()).body, ada)
    expect(entry).toMatchObject({ startStatus: "todo", status: "review", completedAt: null })
    expect(entry.changes).toEqual([
      {
        fromStatus: "todo",
        toStatus: "in_progress",
        at: FROM,
        by: { id: ownerId, name: "owner", avatarUrl: null },
      },
      {
        fromStatus: "in_progress",
        toStatus: "review",
        at: d(5),
        by: { id: ownerId, name: "owner", avatarUrl: null },
      },
    ])
  })

  test("orders completed work by completion, then review to backlog, then key", async () => {
    const { owner, url, person, task, week, tasksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const api = await owner.call("POST", `${url}/projects`, { name: "Api", key: "API" })
    const story = (statuses: [Status, string][]): Story => ({
      created: d(-10),
      statuses: [["todo", d(-10)], ...statuses],
      assigned: [[ada, d(-10)]],
    })
    const backlog = await task(story([["backlog", d(3)]]))
    const todoWeb = await task(story([]))
    const late = await task(story([["complete", d(6)]]))
    const todoApi = await task(story([]), api.body.project.id)
    const review = await task(story([["review", d(3)]]))
    const early = await task(story([["complete", d(3)]]))
    const progress = await task(story([["in_progress", d(3)]]))
    const todoWeb2 = await task(story([]))

    const tasks = tasksOf((await week()).body, ada) ?? []
    expect(tasks.map((x) => x.key)).toEqual(
      [early, late, review, progress, todoApi, todoWeb, todoWeb2, backlog].map((x) => x.key),
    )
  })

  test("work in another workspace stays out", async () => {
    const { t, person, week, tasksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const other = await setupProject(t, "other@example.com")
    await addMember(t, other.workspaceId, "ada@example.com")
    const res = await other.owner.call("POST", `/api/projects/${other.project.id}/tasks`, {
      title: "Elsewhere",
      assigneeIds: [ada],
    })
    expect(res.status).toBe(201)
    const now = Date.now()
    const body = (
      await week(new Date(now - DAY_MS).toISOString(), new Date(now + DAY_MS).toISOString())
    ).body
    expect(tasksOf(body, ada)).toEqual([])
  })

  test("the number of queries does not grow with the number of tasks", async () => {
    const { t, workspaceId, person, task } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const add = () =>
      task({
        created: d(-10),
        statuses: [
          ["todo", d(-10)],
          ["in_progress", d(3)],
        ],
        assigned: [[ada, d(-10)]],
      })

    const countQueries = async () => {
      let count = 0
      const counting = t.db.withPlugin({
        transformQuery: (args) => {
          count++
          return args.node
        },
        transformResult: async (args) => args.result,
      })
      await loadWeekLog(counting, workspaceId, FROM, TO)
      return count
    }
    await add()
    const few = await countQueries()
    for (let i = 0; i < 8; i++) await add()
    expect(await countQueries()).toBe(few)
  })
})

describe("weekly log checks", () => {
  const done = (day: number) => ({
    created: d(-10),
    statuses: [
      ["todo", d(-10)],
      ["complete", d(day)],
    ] as [Status, string][],
    assigned: [] as [string, string, string?][],
  })

  test("credits the reviewer and the tester for a task completed in the week", async () => {
    const { project, person, task, week, checksOf, tasksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const bea = await person("bea@example.com", "Bea")
    const t1 = await task({ ...done(4), reviewedBy: ada, testedBy: bea }, project.id, "Shipped")

    const body = (await week()).body
    // Ada only reviewed and has no tasks of her own; that still earns her a place in the log.
    expect(tasksOf(body, ada)).toEqual([])
    expect(checksOf(body, ada)).toEqual([
      {
        id: t1.id,
        key: t1.key,
        title: "Shipped",
        project: { id: project.id, name: "Website", key: project.key },
        completedAt: d(4),
        reviewed: true,
        tested: false,
      },
    ])
    expect(checksOf(body, bea)).toEqual([
      expect.objectContaining({ id: t1.id, reviewed: false, tested: true }),
    ])
  })

  test("a task created already complete credits its reviewer in that week", async () => {
    const { project, owner, person, week, checksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const res = await owner.call("POST", `/api/projects/${project.id}/tasks`, {
      title: "Born done",
      status: "complete",
      reviewedById: ada,
      testedById: null,
    })
    expect(res.status).toBe(201)
    // The week around now.
    const now = Date.now()
    const body = (
      await week(new Date(now - DAY_MS).toISOString(), new Date(now + DAY_MS).toISOString())
    ).body
    expect(checksOf(body, ada)).toEqual([
      expect.objectContaining({
        id: res.body.task.id,
        title: "Born done",
        reviewed: true,
        tested: false,
      }),
    ])
  })

  test("one person who did both gets a single entry flagged as both", async () => {
    const { person, task, week, checksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    await task({ ...done(4), reviewedBy: ada, testedBy: ada })
    expect(checksOf((await week()).body, ada)).toEqual([
      expect.objectContaining({ reviewed: true, tested: true }),
    ])
  })

  test("only the week of completion counts, and the last move to complete is the time shown", async () => {
    const { person, task, week, checksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const at = (statuses: [Status, string][], title: string) =>
      task(
        { created: d(-10), statuses, assigned: [], reviewedBy: ada, testedBy: null },
        undefined,
        title,
      )
    await at([["complete", d(-3)]], "last week")
    await at([["complete", d(12)]], "next week")
    await at([["todo", d(-10)]], "not complete")
    await at(
      [
        ["complete", d(3)],
        ["review", d(4)],
        ["complete", d(5)],
        ["review", d(6)],
      ],
      "reopened",
    )

    const checks = checksOf((await week()).body, ada) ?? []
    // Reopened later in the week, it still moved to complete inside it.
    expect(checks.map((c) => [c.title, c.completedAt])).toEqual([["reopened", d(5)]])
  })

  test("are sorted by when they were completed", async () => {
    const { person, task, week, checksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    await task({ ...done(6), reviewedBy: ada, testedBy: null }, undefined, "late")
    await task({ ...done(3), reviewedBy: null, testedBy: ada }, undefined, "early")
    await task({ ...done(5), reviewedBy: ada, testedBy: null }, undefined, "middle")
    expect((checksOf((await week()).body, ada) ?? []).map((c) => c.title)).toEqual([
      "early",
      "middle",
      "late",
    ])
  })

  test("nobody and unanswered credit no one", async () => {
    const { task, week } = await setup()
    await task({ ...done(4), reviewedBy: null, testedBy: null })
    await task({ ...done(4) })
    const people = (await week()).body.people as WeekLog["people"]
    expect(people.flatMap((p) => p.checks)).toEqual([])
  })

  test("a former member is listed as not a member, with their checks", async () => {
    const { t, task, week, checksOf } = await setup()
    await signIn(t.app, "gone@example.com", "Gone")
    const gone = await userId(t, "gone@example.com")
    await task({ ...done(4), reviewedBy: gone, testedBy: null })

    const body = (await week()).body
    expect(body.people.find((p: WeekLog["people"][number]) => p.user.id === gone)).toMatchObject({
      user: { id: gone, name: "Gone" },
      member: false,
      tasks: [],
    })
    expect(checksOf(body, gone)).toHaveLength(1)
  })

  test("work in another workspace is left out", async () => {
    const { t, person, week, checksOf } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const other = await setupProject(t, "other@example.com")
    await addMember(t, other.workspaceId, "ada@example.com")
    const res = await other.owner.call("POST", `/api/projects/${other.project.id}/tasks`, {
      title: "Elsewhere",
      status: "complete",
      reviewedById: ada,
      testedById: null,
    })
    expect(res.status).toBe(201)
    expect(checksOf((await week()).body, ada)).toEqual([])
  })

  test("the number of queries does not grow with the number of checks", async () => {
    const { t, workspaceId, person, task } = await setup()
    const ada = await person("ada@example.com", "Ada")
    const add = () => task({ ...done(4), reviewedBy: ada, testedBy: ada })
    const countQueries = async () => {
      let count = 0
      const counting = t.db.withPlugin({
        transformQuery: (args) => {
          count++
          return args.node
        },
        transformResult: async (args) => args.result,
      })
      await loadWeekLog(counting, workspaceId, FROM, TO)
      return count
    }
    await add()
    const few = await countQueries()
    for (let i = 0; i < 8; i++) await add()
    expect(await countQueries()).toBe(few)
  })
})
