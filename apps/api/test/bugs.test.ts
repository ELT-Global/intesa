import { describe, expect, test } from "bun:test"
import { addTag, createTestApp, setupProject, signIn, type TestApp } from "./helpers"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

async function setup() {
  const t = await createTestApp()
  const { owner, workspaceId, project } = await setupProject(t, "bugs@example.com")
  // Matched by name whatever its case.
  const bugTag = await addTag(t, workspaceId, "Bug")
  const createTask = async (fields: Record<string, unknown>) => {
    const res = await owner.call("POST", `/api/projects/${project.id}/tasks`, fields)
    expect(res.status).toBe(201)
    return res.body.task as { id: string; key: string; title: string }
  }
  const bugs = async (query = "") =>
    (await owner.call("GET", `/api/projects/${project.id}/bugs${query}`)).body.bugs
  const taskBug = async (taskId: string) =>
    (await owner.call("GET", `/api/tasks/${taskId}`)).body.task.bug
  const complete = (taskId: string) =>
    owner.call("PATCH", `/api/tasks/${taskId}`, {
      status: "complete",
      reviewedById: null,
      testedById: null,
    })
  const upload = (path: string, name: string, content: string | Buffer, type = "") => {
    const body = new FormData()
    body.set("file", new File([content], name, { type }))
    return owner.request(path, { method: "POST", body })
  }
  return { t, owner, workspaceId, project, bugTag, createTask, bugs, taskBug, complete, upload }
}

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary response shapes
const json = async (res: Response) => (await res.json()) as any

const count = async (t: TestApp, table: "blobs" | "bugImages" | "bugs") =>
  Number(
    (
      await t.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll().as("n"))
        .executeTakeFirstOrThrow()
    ).n,
  )

describe("bug creation", () => {
  test("a task created with the bug tag opens a bug with its title and no description", async () => {
    const { owner, project, bugTag, createTask, bugs, taskBug } = await setup()
    const task = await createTask({ title: "Login fails", body: "Steps", tagIds: [bugTag] })

    const [bug] = await bugs()
    expect(bug).toEqual({
      id: expect.any(String),
      projectId: project.id,
      number: 1,
      key: `${project.key}-B1`,
      title: "Login fails",
      status: "pending",
      tasks: [
        {
          id: task.id,
          key: task.key,
          title: "Login fails",
          status: "todo",
          createdAt: expect.any(String),
          assignees: [],
        },
      ],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    // The detail adds the bug's own description and each task's.
    const detail = await owner.call("GET", `/api/bugs/${bug.id}`)
    expect(detail.body.bug).toEqual({
      ...bug,
      body: null,
      tasks: [{ ...bug.tasks[0], body: "Steps" }],
    })
    expect(await taskBug(task.id)).toEqual({
      id: bug.id,
      key: `${project.key}-B1`,
      title: "Login fails",
      status: "pending",
    })

    const plain = await createTask({ title: "Not a bug" })
    expect(await taskBug(plain.id)).toBeNull()
  })

  test("tagging an existing task opens one bug, however often the tags change after", async () => {
    const { t, owner, workspaceId, bugTag, createTask, bugs } = await setup()
    const task = await createTask({ title: "Later a bug" })
    expect(await bugs()).toEqual([])
    const other = await addTag(t, workspaceId, "ux")
    await owner.call("PATCH", `/api/tasks/${task.id}`, { tagIds: [bugTag] })
    await owner.call("PATCH", `/api/tasks/${task.id}`, { tagIds: [other, bugTag] })
    const list = await bugs()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ number: 1, title: "Later a bug" })
  })
})

describe("assignees", () => {
  test("each of a bug's tasks lists who it is assigned to", async () => {
    const { owner, createTask, bugTag, bugs } = await setup()
    const me = (await owner.call("GET", "/api/me")).body.user
    const task = await createTask({ title: "Crash", tagIds: [bugTag], assigneeIds: [me.id] })
    const [bug] = await bugs()
    const assignee = { id: me.id, name: me.name, avatarUrl: me.avatarUrl }
    expect(bug.tasks).toEqual([expect.objectContaining({ id: task.id, assignees: [assignee] })])
    const detail = (await owner.call("GET", `/api/bugs/${bug.id}`)).body.bug
    expect(detail.tasks[0].assignees).toEqual([assignee])
    await owner.call("PATCH", `/api/tasks/${task.id}`, { assigneeIds: [] })
    expect((await bugs())[0].tasks[0].assignees).toEqual([])
  })
})

describe("own description", () => {
  test("task edits never change the bug, whose detail shows the task's current description", async () => {
    const { t, owner, bugTag, createTask, bugs, upload } = await setup()
    // The new-task dialog creates the task, uploads its screenshot, then patches the body.
    const task = await createTask({ title: "Crash", tagIds: [bugTag] })
    const artifacts = `/api/tasks/${task.id}/artifacts`
    const shot = (await json(await upload(artifacts, "shot.png", PNG, "image/png"))).artifact
    const body = `![shot](${artifacts}/${shot.id})`
    const patched = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      title: "Crash on save",
      body,
    })
    expect(patched.status).toBe(200)

    const [bug] = await bugs()
    const detail = (await owner.call("GET", `/api/bugs/${bug.id}`)).body.bug
    expect(detail).toMatchObject({ title: "Crash", body: null })
    // The task's own links, served by the task's artifacts.
    expect(detail.tasks).toMatchObject([{ id: task.id, title: "Crash on save", body }])
    expect(await count(t, "bugImages")).toBe(0)

    await owner.call("PATCH", `/api/tasks/${task.id}`, { title: "Renamed", body: "Fixed?" })
    const after = (await owner.call("GET", `/api/bugs/${bug.id}`)).body.bug
    expect(after).toMatchObject({ title: "Crash", body: null, updatedAt: detail.updatedAt })
    expect(after.tasks).toMatchObject([{ title: "Renamed", body: "Fixed?" }])
    expect((await owner.request(`${artifacts}/${shot.id}`)).status).toBe(404)
  })

  test("editing a bug leaves its tasks alone", async () => {
    const { owner, bugTag, createTask, bugs } = await setup()
    const task = await createTask({ title: "Typo", body: "On home", tagIds: [bugTag] })
    const [bug] = await bugs()
    const edited = await owner.call("PATCH", `/api/bugs/${bug.id}`, {
      title: "Typo in hero",
      body: "Hero says 'Welcom'",
    })
    expect(edited.status).toBe(200)
    expect(edited.body.bug).toMatchObject({
      title: "Typo in hero",
      body: "Hero says 'Welcom'",
      tasks: [{ id: task.id, title: "Typo", body: "On home" }],
    })
    const after = (await owner.call("GET", `/api/tasks/${task.id}`)).body.task
    expect(after).toMatchObject({ title: "Typo", body: "On home" })
  })
})

describe("status and regressions", () => {
  test("a bug is resolved when all its tasks are complete; a regression reopens it", async () => {
    const { owner, project, bugTag, createTask, bugs, complete } = await setup()
    const first = await createTask({ title: "Slow search", tagIds: [bugTag] })
    const [bug] = await bugs()
    const regress = (body: Record<string, unknown> = {}) =>
      owner.call("POST", `/api/bugs/${bug.id}/tasks`, body)

    const refused = await regress()
    expect(refused.status).toBe(409)
    expect(refused.body).toEqual({
      code: "CONFLICT",
      message: "Complete this bug's open task before opening another.",
    })

    await complete(first.id)
    expect((await bugs())[0].status).toBe("resolved")
    expect(await bugs("?status=pending")).toEqual([])
    expect(await bugs("?status=resolved")).toHaveLength(1)

    const opened = await regress({ priority: "high" })
    expect(opened.status).toBe(201)
    expect(opened.body.task).toMatchObject({
      projectId: project.id,
      title: "Slow search",
      body: null,
      priority: "high",
      tags: [{ id: bugTag, name: "Bug" }],
    })
    expect(opened.body.bug).toMatchObject({ id: bug.id, status: "pending" })
    expect(opened.body.bug.tasks.map((x: { id: string }) => x.id)).toEqual([
      first.id,
      opened.body.task.id,
    ])
  })

  test("a regression creates the bug tag when it was deleted", async () => {
    const { owner, bugTag, createTask, bugs, complete } = await setup()
    const first = await createTask({ title: "Flaky", tagIds: [bugTag] })
    const [bug] = await bugs()
    await complete(first.id)
    await owner.call("DELETE", `/api/tags/${bugTag}`)

    const opened = await owner.call("POST", `/api/bugs/${bug.id}/tasks`, { title: "Flaky again" })
    expect(opened.status).toBe(201)
    expect(opened.body.task.tags).toMatchObject([{ name: "bug" }])
    expect(opened.body.task.title).toBe("Flaky again")
  })

  test("lists pending bugs first, then newest first", async () => {
    const { bugTag, createTask, bugs, complete } = await setup()
    await createTask({ title: "One", tagIds: [bugTag] })
    const two = await createTask({ title: "Two", tagIds: [bugTag] })
    await createTask({ title: "Three", tagIds: [bugTag] })
    await complete(two.id)
    expect((await bugs()).map((b: { title: string }) => b.title)).toEqual(["Three", "One", "Two"])
  })
})

describe("unlinking", () => {
  test("removing the tag or deleting a task unlinks it, and a bug without tasks goes", async () => {
    const { t, owner, bugTag, createTask, bugs, taskBug, complete } = await setup()
    const first = await createTask({ title: "Wrong total", tagIds: [bugTag] })
    const [bug] = await bugs()
    await complete(first.id)
    const second = (await owner.call("POST", `/api/bugs/${bug.id}/tasks`, {})).body.task

    await owner.call("PATCH", `/api/tasks/${second.id}`, { tagIds: [] })
    expect(await taskBug(second.id)).toBeNull()
    expect((await bugs())[0].tasks.map((x: { id: string }) => x.id)).toEqual([first.id])

    await owner.call("DELETE", `/api/tasks/${first.id}`)
    expect(await count(t, "bugs")).toBe(0)
    expect((await owner.call("GET", `/api/bugs/${bug.id}`)).status).toBe(404)

    // Tagging again opens a new bug.
    await owner.call("PATCH", `/api/tasks/${second.id}`, { tagIds: [bugTag] })
    expect((await bugs()).map((b: { number: number }) => b.number)).toEqual([2])
  })
})

describe("bug images", () => {
  test("uploads images only, serves them like image artifacts, and drops them with the body", async () => {
    const { t, owner, bugTag, createTask, bugs, upload } = await setup()
    await createTask({ title: "Glitch", tagIds: [bugTag] })
    const [bug] = await bugs()
    const images = `/api/bugs/${bug.id}/images`

    const res = await upload(images, "glitch.png", PNG, "image/png")
    expect(res.status).toBe(201)
    const { image } = await json(res)
    expect(image).toEqual({
      id: expect.any(String),
      name: "glitch.png",
      mimeType: "image/png",
      size: PNG.length,
    })
    const download = await owner.request(`${images}/${image.id}`)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(PNG)
    expect(download.headers.get("content-type")).toBe("image/png")
    expect(download.headers.get("cache-control")).toBe("private, max-age=86400")
    expect(download.headers.get("x-content-type-options")).toBe("nosniff")

    expect((await upload(images, "notes.md", "# Notes")).status).toBe(400)
    expect((await upload(images, "fake.png", "not a png")).status).toBe(400)

    const link = `![glitch](${images}/${image.id})`
    await owner.call("PATCH", `/api/bugs/${bug.id}`, { body: `See ${link}` })
    await owner.call("PATCH", `/api/bugs/${bug.id}`, { body: link })
    expect((await owner.request(`${images}/${image.id}`)).status).toBe(200)
    await owner.call("PATCH", `/api/bugs/${bug.id}`, { body: "Gone" })
    expect((await owner.request(`${images}/${image.id}`)).status).toBe(404)

    // An upload that never reached a saved body is deleted by the client.
    const { image: unsaved } = await json(await upload(images, "draft.png", PNG, "image/png"))
    const remove = () => owner.request(`${images}/${unsaved.id}`, { method: "DELETE" })
    expect((await remove()).status).toBe(204)
    expect((await owner.request(`${images}/${unsaved.id}`)).status).toBe(404)
    expect((await remove()).status).toBe(404)
    expect(await t.db.selectFrom("blobs").select("hash").execute()).toEqual([])
  })
})

describe("access", () => {
  test("bugs of other workspaces are not found, by id or by key", async () => {
    const { t, owner, workspaceId, project, bugTag, createTask, bugs, upload } = await setup()
    await createTask({ title: "Private", tagIds: [bugTag] })
    const [bug] = await bugs()
    const image = (
      await json(await upload(`/api/bugs/${bug.id}/images`, "a.png", PNG, "image/png"))
    ).image

    const byKey = await owner.call(
      "GET",
      `/api/workspaces/${workspaceId}/bugs/${project.key.toLowerCase()}-b1`,
    )
    expect(byKey.status).toBe(200)
    expect(byKey.body.bug).toMatchObject({ id: bug.id, body: null })
    expect(
      (await owner.call("GET", `/api/workspaces/${workspaceId}/bugs/${project.key}-B9`)).status,
    ).toBe(404)
    expect((await owner.call("GET", `/api/workspaces/${workspaceId}/bugs/nonsense`)).status).toBe(
      404,
    )

    const outsider = await signIn(t.app, "outsider@example.com")
    const form = new FormData()
    form.set("file", new File([PNG], "b.png", { type: "image/png" }))
    const refused = [
      await outsider.call("GET", `/api/projects/${project.id}/bugs`),
      await outsider.call("GET", `/api/bugs/${bug.id}`),
      await outsider.call("PATCH", `/api/bugs/${bug.id}`, { title: "Mine" }),
      await outsider.call("POST", `/api/bugs/${bug.id}/tasks`, {}),
      await outsider.call("GET", `/api/bugs/${bug.id}/images/${image.id}`),
      await outsider.call("GET", `/api/workspaces/${workspaceId}/bugs/${project.key}-B1`),
    ]
    expect(refused.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404])
    const uploadRes = await outsider.request(`/api/bugs/${bug.id}/images`, {
      method: "POST",
      body: form,
    })
    expect(uploadRes.status).toBe(404)
    expect((await owner.call("GET", `/api/bugs/${bug.id}`)).body.bug.title).toBe("Private")
  })
})
