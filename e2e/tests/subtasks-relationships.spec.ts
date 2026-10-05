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

  await subtasks.getByRole("button", { name: "Mark Design it complete" }).click()
  await expect(subtasks).toContainText("1/2")

  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: /Parent task/ })).toContainText("1/2")
  // Subtasks live in the parent, not on the board.
  await expect(page.getByRole("button", { name: /Build it/ })).toHaveCount(0)

  await page.goto(`${board(project.id)}?task=${parent.id}`)
  await sheet
    .getByRole("region", { name: "Subtasks" })
    .getByRole("button", { name: "Build it", exact: true })
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
