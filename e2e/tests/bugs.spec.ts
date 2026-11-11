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

  // A task chip opens the task sheet, which links back to its bug.
  await bugRow(page, bug.key)
    .getByRole("button", { name: `${task.key} Complete` })
    .click()
  await expect(taskSheet).toBeVisible()
  await taskSheet.getByRole("link", { name: new RegExp(`Bug: ${bug.key}`) }).click()
  await expect(bugSheet(page, bug.key)).toBeVisible()
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
  await expect(sheet.getByText(`Follows ${task.key} until edited`)).toBeVisible()

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
  await expect(taskSheet.getByRole("link", { name: new RegExp(`Bug: ${bug.key}`) })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(taskSheet).toBeHidden()

  const row = bugRow(page, bug.key)
  await expect(row).toContainText("Pending")
  await expect(row.getByRole("button", { name: `${reopened.key} Todo` })).toBeVisible()
  await row.getByRole("button", { name: "Crash on save" }).click()
  await expect(open).toBeDisabled()
  await expect(sheet.getByText(`Complete ${reopened.key} first`)).toBeVisible()
})

test("editing a bug leaves its task alone and stops it following the task", async ({ page }) => {
  const { project, bugTag, createTask, bugsPath } = await setup(page)
  const task = await createTask({ title: "Slow search", body: "Takes ages", tagIds: [bugTag] })
  const bug = await onlyBug(page, project.id)
  await page.goto(`${bugsPath}?bug=${bug.id}`)

  const sheet = bugSheet(page, bug.key)
  await expect(sheet.getByText(`Follows ${task.key} until edited`)).toBeVisible()
  const title = sheet.getByRole("textbox", { name: "Bug title" })
  await title.fill("Search is slow on big projects")
  await title.press("Enter")
  await expect(sheet.getByText(`Follows ${task.key} until edited`)).toBeHidden()

  const body = sheet.getByRole("textbox", { name: "Description" })
  await expect(sheet.locator('[data-editor="ready"]')).toBeVisible()
  await body.click()
  await body.press("ControlOrMeta+a")
  await body.pressSequentially("Over 3 seconds")
  await body.blur()
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/bugs/${bug.id}`)
      return ((await res.json()) as { bug: { body: string } }).bug.body
    })
    .toBe("Over 3 seconds")

  expect(await taskOf(page, task.id)).toMatchObject({ title: "Slow search", body: "Takes ages" })

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

test("a screenshot in the task's description shows in the bug, and the bug takes its own", async ({
  page,
}) => {
  const { slug, project, bugTag, createTask, bugsPath } = await setup(page)
  const task = await createTask({ title: "Header overlaps", tagIds: [bugTag] })

  // Paste a screenshot into the task's description; the bug follows it.
  await page.goto(`/w/${slug}/projects/${project.id}/board?task=${task.id}`)
  const taskSheet = page.getByRole("dialog", { name: task.key })
  await expect(taskSheet.locator('[data-editor="ready"]')).toBeVisible()
  const taskBody = taskSheet.getByRole("textbox", { name: "Description" })
  await taskBody.click()
  await pasteImage(taskBody)
  await expect(taskSheet.locator("img.cm-lp-image")).toBeVisible()
  await taskBody.blur()
  await expect.poll(async () => (await taskOf(page, task.id)).body).toContain("/artifacts/")

  const bug = await onlyBug(page, project.id)
  await page.goto(`${bugsPath}?bug=${bug.id}`)
  const sheet = bugSheet(page, bug.key)
  await expect(sheet.locator('[data-editor="ready"]')).toBeVisible()
  const image = sheet.locator("img.cm-lp-image")
  await expect(image).toHaveAttribute("src", new RegExp(`^/api/bugs/${bug.id}/images/[\\w-]+$`))
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)

  // A screenshot pasted into the bug is stored with the bug.
  const body = sheet.getByRole("textbox", { name: "Description" })
  await body.click()
  await body.press("ControlOrMeta+End")
  await pasteImage(body)
  await expect(sheet.locator("img.cm-lp-image")).toHaveCount(2)
  await body.blur()
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/bugs/${bug.id}`)
      const saved = ((await res.json()) as { bug: { body: string } }).bug.body
      return saved.match(new RegExp(`/api/bugs/${bug.id}/images/`, "g"))?.length ?? 0
    })
    .toBe(2)
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
  const body = sheet.getByRole("textbox", { name: "Description" })
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
