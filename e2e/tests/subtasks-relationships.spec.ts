import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  const board = (projectId: string) => `/w/${slug}/projects/${projectId}/board`
  const open = (projectId: string, taskId: string) =>
    page.goto(`${board(projectId)}?task=${taskId}`)
  return { slug, workspaceId, project, board, open }
}

const group = (page: Page, name: string) =>
  page.getByRole("dialog").getByRole("group", { name, exact: true })

async function addRelationship(page: Page, type: string, target: { title: string; key: string }) {
  const dialog = page.getByRole("dialog").first()
  await dialog.getByRole("button", { name: "Add relationship" }).click()
  await page.getByRole("button", { name: type, exact: true }).click()
  await page.getByRole("combobox").fill(target.title)
  await page.getByRole("option", { name: new RegExp(target.key) }).click()
  await page.keyboard.press("Escape")
}

test("subtasks are added from the sheet, tracked as progress, and open as their own task", async ({
  page,
}) => {
  const { project, board, open } = await setup(page)
  const parent = await createTaskViaApi(page, project.id, { title: "Parent task" })
  await open(project.id, parent.id)

  const sheet = page.getByRole("dialog", { name: parent.key })
  const subtasks = sheet.getByRole("region", { name: "Subtasks" })
  for (const title of ["Design it", "Build it"]) {
    await subtasks.getByLabel("Add subtask").fill(title)
    await subtasks.getByLabel("Add subtask").press("Enter")
    await expect(subtasks.getByRole("button", { name: title, exact: true })).toBeVisible()
  }
  await expect(subtasks).toContainText("0/2")

  await subtasks.getByRole("button", { name: "Change status of Design it" }).click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()
  await expect(subtasks).toContainText("1/2")

  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: /Parent task/ })).toContainText("1/2")
  // Subtasks live in the parent, not on the board.
  await expect(page.getByRole("button", { name: /Build it/ })).toHaveCount(0)

  await page.goto(`${board(project.id)}?task=${parent.id}`)
  await sheet
    .getByRole("region", { name: "Subtasks" })
    .getByRole("button", { name: "Open Build it" })
    .click()
  await expect(page.getByRole("button", { name: /Parent: .*Parent task/ })).toBeVisible()
  await expect(page.getByLabel("Add subtask")).toHaveCount(0)

  await page.getByRole("button", { name: /Parent: .*Parent task/ }).click()
  await expect(page.getByRole("dialog", { name: parent.key })).toBeVisible()
})

test("blocking and related relationships show on both sides and can be removed", async ({
  page,
}) => {
  const { project, open } = await setup(page)
  const a = await createTaskViaApi(page, project.id, { title: "Alpha work" })
  const b = await createTaskViaApi(page, project.id, { title: "Bravo work" })
  const c = await createTaskViaApi(page, project.id, { title: "Charlie work" })
  const withTitle = (t: { key: string }, title: string) => ({ key: t.key, title })

  await open(project.id, a.id)
  const dialog = page.getByRole("dialog").first()

  // The task itself is never offered.
  await dialog.getByRole("button", { name: "Add relationship" }).click()
  await page.getByRole("combobox").fill("Alpha work")
  await expect(page.getByRole("option", { name: new RegExp(a.key) })).toHaveCount(0)
  await page.keyboard.press("Escape")

  await addRelationship(page, "Blocked by", withTitle(b, "Bravo work"))
  await expect(group(page, "Blocked by")).toContainText(b.key)
  await addRelationship(page, "Related", withTitle(c, "Charlie work"))
  await expect(group(page, "Related")).toContainText(c.key)

  await open(project.id, b.id)
  await expect(group(page, "Blocks")).toContainText(a.key)
  await open(project.id, c.id)
  await expect(group(page, "Related")).toContainText(a.key)

  await open(project.id, a.id)
  await group(page, "Related")
    .getByRole("button", { name: `Remove ${c.key}` })
    .click()
  await expect(group(page, "Related")).toHaveCount(0)
  await group(page, "Blocked by")
    .getByRole("button", { name: `Remove ${b.key}` })
    .click()
  await expect(group(page, "Blocked by")).toHaveCount(0)

  await open(project.id, b.id)
  await expect(group(page, "Blocks")).toHaveCount(0)
})

test("a relationship to a task in another project opens that project's board", async ({ page }) => {
  const { slug, workspaceId, project, open } = await setup(page)
  const other = await createProject(page, workspaceId, uniqueName("Other"))
  const a = await createTaskViaApi(page, project.id, { title: "Local work" })
  const b = await createTaskViaApi(page, other.id, { title: "Elsewhere work" })

  await open(project.id, a.id)
  await addRelationship(page, "Related", { key: b.key, title: "Elsewhere work" })
  await group(page, "Related")
    .getByRole("button", { name: new RegExp(`^${b.key}`) })
    .click()

  await expect(page).toHaveURL(new RegExp(`/w/${slug}/projects/${other.id}/board\\?task=${b.id}`))
  await expect(page.getByRole("dialog", { name: b.key })).toBeVisible()
  await expect(group(page, "Related")).toContainText(a.key)
})

test("a circular block is rejected with the server's message", async ({ page }) => {
  const { project, open } = await setup(page)
  const a = await createTaskViaApi(page, project.id, { title: "First link" })
  const b = await createTaskViaApi(page, project.id, { title: "Second link" })
  const c = await createTaskViaApi(page, project.id, { title: "Third link" })

  await open(project.id, a.id)
  await addRelationship(page, "Blocks", { key: b.key, title: "Second link" })
  await expect(group(page, "Blocks")).toContainText(b.key)

  await open(project.id, b.id)
  await addRelationship(page, "Blocks", { key: c.key, title: "Third link" })
  await expect(group(page, "Blocks")).toContainText(c.key)

  await open(project.id, c.id)
  await addRelationship(page, "Blocks", { key: a.key, title: "First link" })
  await expect(page.getByRole("alert")).toContainText("circular")
  await expect(group(page, "Blocks")).toHaveCount(0)
})

/** Counts finished writes of one method, so tests wait for the server rather than guessing. */
function trackWrites(page: Page, method: "PATCH" | "DELETE") {
  let finished = 0
  // Responses, not requestfinished: bodiless 204 replies are reported as aborted requests.
  page.on("response", (r) => {
    if (r.request().method() === method && r.ok() && r.url().includes("/api/tasks/")) finished++
  })
  return { waitFor: (n: number) => expect.poll(() => finished).toBeGreaterThanOrEqual(n) }
}

async function parentWithSubtasks(page: Page, titles: string[]) {
  const ctx = await setup(page)
  const parent = await createTaskViaApi(page, ctx.project.id, { title: "Parent task" })
  for (const title of titles) {
    const res = await page.request.post(`/api/projects/${ctx.project.id}/tasks`, {
      data: { title, parentTaskId: parent.id },
    })
    expect(res.status()).toBe(201)
  }
  await ctx.open(ctx.project.id, parent.id)
  const subtasks = page.getByRole("dialog", { name: parent.key }).getByRole("region", {
    name: "Subtasks",
  })
  await expect(subtasks.getByRole("listitem")).toHaveCount(titles.length)
  const row = (title: string) =>
    subtasks
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: title, exact: true }) })
  return { ...ctx, parent, subtasks, row }
}

test("a subtask's title, priority and assignee are edited from its row and persist", async ({
  page,
}) => {
  const writes = trackWrites(page, "PATCH")
  const { subtasks, row } = await parentWithSubtasks(page, ["Draft"])

  await row("Draft").getByRole("button", { name: "Draft", exact: true }).click()
  const input = subtasks.getByRole("textbox", { name: "Subtask title" })
  await input.fill("Draft v2")
  await input.press("Enter")
  await expect(row("Draft v2")).toBeVisible()

  // Escape abandons an edit.
  await row("Draft v2").getByRole("button", { name: "Draft v2", exact: true }).click()
  await subtasks.getByRole("textbox", { name: "Subtask title" }).fill("Nope")
  await page.keyboard.press("Escape")
  await expect(row("Draft v2")).toBeVisible()
  await expect(subtasks.getByRole("textbox", { name: "Subtask title" })).toHaveCount(0)

  await row("Draft v2")
    .getByRole("button", { name: /Change priority/ })
    .click()
  await page.getByRole("menuitemradio", { name: "High" }).click()

  await row("Draft v2")
    .getByRole("button", { name: /Change assignees/ })
    .click()
  await page.getByRole("option", { name: "Assign to me" }).click()
  await page.keyboard.press("Escape")
  await expect(row("Draft v2").getByRole("img")).toHaveCount(1)

  await writes.waitFor(3)
  await page.reload()
  const after = page.getByRole("region", { name: "Subtasks" })
  const reloaded = after.getByRole("listitem").filter({
    has: page.getByRole("button", { name: "Draft v2", exact: true }),
  })
  await expect(reloaded).toBeVisible()
  await expect(reloaded.getByRole("img")).toHaveCount(1)
  await reloaded.getByRole("button", { name: /Change priority/ }).click()
  await expect(page.getByRole("menuitemradio", { name: "High" })).toBeChecked()
})

test("the status dropdown sets any status and progress counts only complete subtasks", async ({
  page,
}) => {
  const { subtasks, row } = await parentWithSubtasks(page, ["One", "Two", "Three"])
  await expect(subtasks).toContainText("0/3")

  await row("One").getByRole("button", { name: "Change status of One" }).click()
  await page.getByRole("menuitemradio", { name: "Review" }).click()
  await row("Two").getByRole("button", { name: "Change status of Two" }).click()
  await page.getByRole("menuitemradio", { name: "In Progress" }).click()
  await expect(subtasks).toContainText("0/3")

  await row("Three").getByRole("button", { name: "Change status of Three" }).click()
  await expect(page.getByRole("menuitemradio", { name: "Todo" })).toBeChecked()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()
  await expect(subtasks).toContainText("1/3")

  // Keyboard only: open with Enter, choose with End. The menu moves focus a tick after the key.
  await row("One").getByRole("button", { name: "Change status of One" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("End")
  await expect(page.getByRole("menuitemradio", { name: "Complete" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(subtasks).toContainText("2/3")
})

test("deleting a subtask asks first and lowers the count", async ({ page }) => {
  const writes = trackWrites(page, "DELETE")
  const { subtasks, row } = await parentWithSubtasks(page, ["Keep me", "Drop me"])
  await expect(subtasks).toContainText("0/2")

  await row("Drop me").getByRole("button", { name: "Actions for Drop me" }).click()
  await page.getByRole("menuitem", { name: "Delete subtask" }).click()
  const confirm = page.getByRole("dialog", { name: "Delete subtask?" })
  await confirm.getByRole("button", { name: "Cancel" }).click()
  await expect(row("Drop me")).toBeVisible()

  await row("Drop me").getByRole("button", { name: "Actions for Drop me" }).click()
  await page.getByRole("menuitem", { name: "Delete subtask" }).click()
  await page
    .getByRole("dialog", { name: "Delete subtask?" })
    .getByRole("button", { name: "Delete" })
    .click()
  await expect(row("Drop me")).toHaveCount(0)
  await expect(subtasks).toContainText("0/1")

  await writes.waitFor(1)
  await page.reload()
  await expect(page.getByRole("region", { name: "Subtasks" }).getByRole("listitem")).toHaveCount(1)
})

test("keyboard-only rename and a cancelled delete keep focus on the row", async ({ page }) => {
  const { subtasks, row } = await parentWithSubtasks(page, ["First", "Second"])

  await row("First").getByRole("button", { name: "First", exact: true }).focus()
  await page.keyboard.press("Enter")
  const input = subtasks.getByRole("textbox", { name: "Subtask title" })
  await expect(input).toBeFocused()
  await input.fill("First renamed")
  await page.keyboard.press("Enter")
  await expect(row("First renamed")).toBeVisible()
  await expect(
    row("First renamed").getByRole("button", { name: "First renamed", exact: true }),
  ).toBeFocused()

  // Escape cancels the edit, keeps the sheet open, and keeps focus on the title.
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await expect(subtasks.getByRole("textbox", { name: "Subtask title" })).toHaveCount(0)
  await expect(
    row("First renamed").getByRole("button", { name: "First renamed", exact: true }),
  ).toBeFocused()

  const actions = row("Second").getByRole("button", { name: "Actions for Second" })
  await actions.focus()
  await page.keyboard.press("Enter")
  await page.getByRole("menuitem", { name: "Delete subtask" }).click()
  await page
    .getByRole("dialog", { name: "Delete subtask?" })
    .getByRole("button", { name: "Cancel" })
    .click()
  await expect(actions).toBeFocused()
})
