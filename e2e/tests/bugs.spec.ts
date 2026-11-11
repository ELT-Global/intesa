import { expect, type Locator, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, setTaskStatus, workspaceIdBySlug } from "../support/projects"

// The "Bugs" link nested under a project in the sidebar.
const sidebarBugs = (page: Page, projectName: string) =>
  page
    .getByRole("region", { name: "Projects", exact: true })
    .getByRole("listitem")
    .filter({ hasText: projectName })
    .getByRole("link", { name: "Bugs", exact: true })

test("a project's Bugs link unfolds when the project is opened, and folds by its chevron", async ({
  page,
}) => {
  const { slug, project, projectName } = await setup(page)
  await page.goto(`/w/${slug}/home`)
  await expect(sidebarBugs(page, projectName)).toHaveCount(0)
  await page
    .getByRole("region", { name: "Projects", exact: true })
    .getByRole("link", { name: projectName })
    .click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}`))
  await expect(sidebarBugs(page, projectName)).toBeVisible()
  await page.getByRole("button", { name: `Collapse ${projectName}`, exact: true }).click()
  await expect(sidebarBugs(page, projectName)).toHaveCount(0)
})

test("a bug shows the avatars of everyone assigned to its tasks", async ({ page }) => {
  const { bugTag, createTask, bugsPath, project } = await setup(page)
  const me = (
    (await (await page.request.get("/api/me")).json()) as { user: { id: string; name: string } }
  ).user
  await createTask({ title: "Crash on save", tagIds: [bugTag], assigneeIds: [me.id] })
  const bug = await onlyBug(page, project.id)
  await page.goto(bugsPath)
  const avatars = bugRow(page, bug.key).getByRole("list", { name: `${bug.key} assignees` })
  await expect(avatars.getByRole("img", { name: me.name })).toBeVisible()
  await bugRow(page, bug.key).getByText("Crash on save").click()
  await expect(bugSheet(page, bug.key).getByRole("img", { name: me.name })).toBeVisible()
})

// A 1×1 PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

type Task = { id: string; key: string }

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const projectName = uniqueName("Bugs")
  const project = await createProject(page, workspaceId, projectName)
  const res = await page.request.post(`/api/workspaces/${workspaceId}/tags`, {
    data: { name: "bug" },
  })
  expect(res.status()).toBe(201)
  const bugTag = ((await res.json()) as { tag: { id: string } }).tag.id
  const createTask = async (data: Record<string, unknown>): Promise<Task> => {
    const created = await page.request.post(`/api/projects/${project.id}/tasks`, { data })
    expect(created.status()).toBe(201)
    return ((await created.json()) as { task: Task }).task
  }
  const bugsPath = `/w/${slug}/projects/${project.id}/bugs`
  return { slug, project, projectName, bugTag, createTask, bugsPath }
}

const bugsList = (page: Page) => page.getByRole("list", { name: "Bugs" })
const bugRow = (page: Page, key: string) =>
  bugsList(page).getByRole("listitem").filter({ hasText: key }).first()
const bugSheet = (page: Page, key: string) => page.getByRole("dialog", { name: key })

async function onlyBug(page: Page, projectId: string) {
  const res = await page.request.get(`/api/projects/${projectId}/bugs`)
  const { bugs } = (await res.json()) as { bugs: { id: string; key: string }[] }
  expect(bugs).toHaveLength(1)
  return bugs[0] as { id: string; key: string }
}

async function taskOf(page: Page, taskId: string) {
  const res = await page.request.get(`/api/tasks/${taskId}`)
  return ((await res.json()) as { task: { title: string; body: string | null } }).task
}

test("tagging a task bug lists it under Bugs as pending, and completing it resolves it", async ({
  page,
}) => {
  const { slug, project, projectName, createTask } = await setup(page)
  const task = await createTask({ title: "Login button does nothing" })
  await page.goto(`/w/${slug}/home`)

  // Before any task is tagged, the page explains where bugs come from.
  // Away from the project its Bugs link is folded away until the chevron opens it.
  await expect(sidebarBugs(page, projectName)).toHaveCount(0)
  await page.getByRole("button", { name: `Expand ${projectName}`, exact: true }).click()
  await sidebarBugs(page, projectName).click()
  await expect(page.getByText("No bugs yet.")).toBeVisible()
  await expect(page.getByText(/Tag a task “bug”/)).toBeVisible()

  // Tag it in the task sheet, then come back: the list is refreshed, not served stale.
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Board" }).click()
  await page.getByRole("button", { name: /Login button does nothing/ }).click()
  const taskSheet = page.getByRole("dialog", { name: task.key })
  await taskSheet.getByRole("button", { name: "Add tag" }).click()
  const picker = page.getByRole("dialog", { name: "Tags" })
  await picker.getByRole("option", { name: "bug" }).click()
  await page.keyboard.press("Escape")
  // The picker fades out; a second Escape sent meanwhile would be swallowed by it.
  await expect(picker).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(taskSheet).toBeHidden()
  await sidebarBugs(page, projectName).click()

  const bug = await onlyBug(page, project.id)
  const row = bugRow(page, bug.key)
  await expect(row).toContainText("Login button does nothing")
  await expect(row).toContainText("Pending")
  await expect(row.getByRole("button", { name: `${task.key} Todo` })).toBeVisible()

  await setTaskStatus(page, task.id, "complete")
  await page.reload()
  await expect(bugRow(page, bug.key)).toContainText("Resolved")
  await expect(
    bugRow(page, bug.key).getByRole("button", { name: `${task.key} Complete` }),
  ).toBeVisible()

  const filter = page.getByRole("group", { name: "Show" })
  await filter.getByRole("button", { name: "Pending" }).click()
  await expect(page.getByText("No pending bugs.")).toBeVisible()
  await filter.getByRole("button", { name: "Resolved" }).click()
  await expect(bugRow(page, bug.key)).toBeVisible()

  // A task chip opens the task sheet, whose bug link opens the bug.
  await bugRow(page, bug.key)
    .getByRole("button", { name: `${task.key} Complete` })
    .click()
  await expect(taskSheet).toBeVisible()
  await taskSheet.getByRole("link", { name: `Open bug ${bug.key}`, exact: true }).click()
  await expect(bugSheet(page, bug.key)).toBeVisible()
  await expect(taskSheet).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/bugs\\?bug=${bug.id}$`))
})

test("a pending bug cannot open a regression task until its open task is complete", async ({
  page,
}) => {
  const { project, bugTag, createTask, bugsPath } = await setup(page)
  const task = await createTask({ title: "Crash on save", tagIds: [bugTag] })
  const bug = await onlyBug(page, project.id)
  await page.goto(`${bugsPath}?bug=${bug.id}`)

  const sheet = bugSheet(page, bug.key)
  const open = sheet.getByRole("button", { name: "Open regression task" })
  await expect(open).toBeDisabled()
  await expect(sheet.getByText(`Complete ${task.key} first`)).toBeVisible()

  await setTaskStatus(page, task.id, "complete")
  await page.reload()
  await expect(open).toBeEnabled()
  await expect(sheet.getByText("Resolved")).toBeVisible()
  await open.click()

  // The new task opens, titled after the bug, and the bug is pending again on it.
  await expect(sheet).toBeHidden()
  const res = await page.request.get(`/api/bugs/${bug.id}`)
  const { tasks } = ((await res.json()) as { bug: { tasks: Task[] } }).bug
  expect(tasks).toHaveLength(2)
  const reopened = tasks[1] as Task
  const taskSheet = page.getByRole("dialog", { name: reopened.key })
  await expect(taskSheet.getByRole("textbox", { name: "Task title" })).toHaveValue("Crash on save")
  await expect(taskSheet.getByRole("link", { name: `Open bug ${bug.key}` })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(taskSheet).toBeHidden()

  const row = bugRow(page, bug.key)
  await expect(row).toContainText("Pending")
  await expect(row.getByRole("button", { name: `${reopened.key} Todo` })).toBeVisible()
  await row.getByRole("button", { name: "Crash on save" }).click()
  await expect(open).toBeDisabled()
  await expect(sheet.getByText(`Complete ${reopened.key} first`)).toBeVisible()
})

test("a bug starts with its own empty description, shows its task's read-only, and edits stay apart", async ({
  page,
}) => {
  const { project, bugTag, createTask, bugsPath } = await setup(page)
  const task = await createTask({ title: "Slow search", body: "Takes ages", tagIds: [bugTag] })
  const bug = await onlyBug(page, project.id)
  await page.goto(`${bugsPath}?bug=${bug.id}`)

  const sheet = bugSheet(page, bug.key)
  await expect(sheet.locator('[data-editor="ready"]').first()).toBeVisible()
  const body = sheet.getByRole("textbox", { name: "Bug description" })
  // Empty: only its placeholder shows.
  await expect(body).toHaveText("Add a description.")
  // The task's description, under the task, rendered and not editable.
  const taskBody = sheet
    .getByRole("list", { name: "Bug tasks" })
    .getByRole("textbox", { name: `${task.key} description` })
  await expect(taskBody).toHaveText("Takes ages")
  await expect(taskBody).toHaveAttribute("contenteditable", "false")
  await expect(sheet.getByText("Follows", { exact: false })).toHaveCount(0)

  const title = sheet.getByRole("textbox", { name: "Bug title" })
  await title.fill("Search is slow on big projects")
  await title.press("Enter")
  await body.click()
  await body.pressSequentially("Over 3 seconds")
  await body.blur()
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/bugs/${bug.id}`)
      return ((await res.json()) as { bug: { body: string } }).bug.body
    })
    .toBe("Over 3 seconds")
  expect(await taskOf(page, task.id)).toMatchObject({ title: "Slow search", body: "Takes ages" })

  // Editing the task changes what the bug shows of it, never the bug's own text.
  const patched = await page.request.patch(`/api/tasks/${task.id}`, {
    data: { title: "Search times out", body: "After 30 seconds" },
  })
  expect(patched.status()).toBe(200)
  await page.reload()
  await expect(title).toHaveValue("Search is slow on big projects")
  await expect(body).toHaveText("Over 3 seconds")
  await expect(taskBody).toHaveText("After 30 seconds")

  await sheet.getByRole("button", { name: "Close" }).click()
  await expect(bugRow(page, bug.key)).toContainText("Search is slow on big projects")
  await expect(
    bugRow(page, bug.key).getByRole("button", { name: `${task.key} Todo` }),
  ).toBeVisible()
})

/** Sends a clipboard event carrying an image file, the way a browser does. */
async function pasteImage(target: Locator) {
  await target.evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], "image.png", { type: "image/png" }))
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
    )
  }, PNG_BASE64)
}

test("a screenshot in the task's description shows under the task, and the bug takes its own", async ({
  page,
}) => {
  const { slug, project, bugTag, createTask, bugsPath } = await setup(page)
  const task = await createTask({ title: "Header overlaps", tagIds: [bugTag] })

  // Paste a screenshot into the task's description.
  await page.goto(`/w/${slug}/projects/${project.id}/board?task=${task.id}`)
  const taskSheet = page.getByRole("dialog", { name: task.key })
  await expect(taskSheet.locator('[data-editor="ready"]')).toBeVisible()
  const taskBody = taskSheet.getByRole("textbox", { name: "Description" })
  await taskBody.click()
  await pasteImage(taskBody)
  await expect(taskSheet.locator("img.cm-lp-image")).toBeVisible()
  await taskBody.blur()
  await expect.poll(async () => (await taskOf(page, task.id)).body).toContain("/artifacts/")

  // The bug shows it under the task, from the task's artifact; its own description is empty.
  const bug = await onlyBug(page, project.id)
  await page.goto(`${bugsPath}?bug=${bug.id}`)
  const sheet = bugSheet(page, bug.key)
  const tasks = sheet.getByRole("list", { name: "Bug tasks" })
  const taskImage = tasks.locator("img.cm-lp-image")
  await expect(taskImage).toHaveAttribute(
    "src",
    new RegExp(`^/api/tasks/${task.id}/artifacts/[\\w-]+$`),
  )
  await expect.poll(() => taskImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
  const body = sheet.getByRole("textbox", { name: "Bug description" })
  // Empty: only its placeholder shows.
  await expect(body).toHaveText("Add a description.")

  // A screenshot pasted into the bug is stored with the bug.
  await body.click()
  await pasteImage(body)
  const bugImage = body.locator("img.cm-lp-image")
  await expect(bugImage).toHaveAttribute("src", new RegExp(`^/api/bugs/${bug.id}/images/[\\w-]+$`))
  await expect.poll(() => bugImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
  await body.blur()
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/bugs/${bug.id}`)
      const saved = ((await res.json()) as { bug: { body: string | null } }).bug.body ?? ""
      return saved.match(new RegExp(`/api/bugs/${bug.id}/images/`, "g"))?.length ?? 0
    })
    .toBe(1)
  expect(await taskOf(page, task.id)).toMatchObject({
    body: expect.stringContaining("/artifacts/"),
  })
})

test("a screenshot pasted into the bug and removed before the description saves is deleted", async ({
  page,
}) => {
  const { project, bugTag, createTask, bugsPath } = await setup(page)
  await createTask({ title: "Footer jumps", tagIds: [bugTag] })
  const bug = await onlyBug(page, project.id)
  await page.goto(`${bugsPath}?bug=${bug.id}`)
  const sheet = bugSheet(page, bug.key)
  await expect(sheet.locator('[data-editor="ready"]')).toBeVisible()
  const body = sheet.getByRole("textbox", { name: "Bug description" })
  await body.click()
  await pasteImage(body)
  await expect(sheet.locator("img.cm-lp-image")).toBeVisible()
  const image = await sheet.locator("img.cm-lp-image").getAttribute("src")
  expect((await page.request.get(image as string)).status()).toBe(200)

  // Escape discards the unsaved edit, image and all.
  await body.press("Escape")
  await body.blur()
  await expect.poll(async () => (await page.request.get(image as string)).status()).toBe(404)
})
