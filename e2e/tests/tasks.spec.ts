import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, workspaceIdBySlug } from "../support/projects"

async function openBoard(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  return { slug, project }
}

async function createTask(page: Page, title: string) {
  await page.getByRole("button", { name: "New task" }).click()
  const dialog = page.getByRole("dialog", { name: "New task" })
  await dialog.getByLabel("Title").fill(title)
  await page.keyboard.press("Enter")
  await expect(dialog).toBeHidden()
}

test("a task created with only a title defaults to Todo with no priority", async ({ page }) => {
  const { project } = await openBoard(page)
  await createTask(page, "Draft launch notes")

  const card = page.getByRole("button", { name: /Draft launch notes/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText(`${project.key}-1`)

  await card.click()
  await expect(page).toHaveURL(/[?&]task=/)
  const sheet = page.getByRole("dialog", { name: `${project.key}-1` })
  await expect(sheet.getByRole("button", { name: "Change status" })).toContainText("Todo")
  await expect(sheet.getByRole("button", { name: "Change priority" })).toContainText("No priority")
  await expect(sheet.getByLabel("Due date", { exact: true })).toHaveValue("")
})

test("title, body, status, priority and due date persist after reload", async ({ page }) => {
  await openBoard(page)
  await createTask(page, "Draft launch notes")
  await page.getByRole("button", { name: /Draft launch notes/ }).click()
  const sheet = page.getByRole("dialog", { name: /-1$/ })

  const title = sheet.getByRole("textbox", { name: "Task title" })
  await title.fill("Publish launch notes")
  await title.press("Enter")

  const body = sheet.getByRole("textbox", { name: "Description" })
  await body.fill("Cover pricing, the migration guide and known limits.")
  await body.blur()

  await sheet.getByRole("button", { name: "Change status" }).click()
  await page.getByRole("menuitemradio", { name: "In Progress" }).click()
  await expect(sheet.getByRole("button", { name: "Change status" })).toContainText("In Progress")

  await sheet.getByRole("button", { name: "Change priority" }).click()
  await page.getByRole("menuitemradio", { name: "High" }).click()
  await expect(sheet.getByRole("button", { name: "Change priority" })).toContainText("High")

  await sheet.getByLabel("Due date", { exact: true }).fill("2031-03-14")
  await expect(sheet.getByLabel("Due date", { exact: true })).toHaveValue("2031-03-14")

  // Wait for the writes to settle before reloading.
  await expect(sheet.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Publish launch notes",
  )
  await page.waitForLoadState("networkidle")
  await page.reload()

  const reloaded = page.getByRole("dialog", { name: /-1$/ })
  await expect(reloaded.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Publish launch notes",
  )
  await expect(reloaded.getByRole("textbox", { name: "Description" })).toHaveValue(
    "Cover pricing, the migration guide and known limits.",
  )
  await expect(reloaded.getByRole("button", { name: "Change status" })).toContainText("In Progress")
  await expect(reloaded.getByRole("button", { name: "Change priority" })).toContainText("High")
  await expect(reloaded.getByLabel("Due date", { exact: true })).toHaveValue("2031-03-14")
})

test("history records creation and each status change", async ({ page }) => {
  await openBoard(page)
  await createTask(page, "Draft launch notes")
  await page.getByRole("button", { name: /Draft launch notes/ }).click()
  const sheet = page.getByRole("dialog", { name: /-1$/ })

  await sheet.getByRole("button", { name: "Change status" }).click()
  await page.getByRole("menuitemradio", { name: "In Progress" }).click()
  await expect(sheet.getByRole("button", { name: "Change status" })).toContainText("In Progress")

  await sheet.getByRole("button", { name: "History" }).click()
  const history = sheet.getByRole("list", { name: "History" })
  await expect(history.getByRole("listitem")).toHaveCount(2)
  await expect(history.getByRole("listitem").first()).toContainText("Created as Todo")
  await expect(history.getByRole("listitem").last()).toContainText("Todo → In Progress")
})

test("deleting a task removes it from the project", async ({ page }) => {
  await openBoard(page)
  await createTask(page, "Draft launch notes")
  await createTask(page, "Keep this one")
  await page.getByRole("button", { name: /Draft launch notes/ }).click()
  const sheet = page.getByRole("dialog", { name: /-1$/ })

  await sheet.getByRole("button", { name: "Delete task" }).click()
  const confirm = page.getByRole("dialog", { name: "Delete task?" })
  await confirm.getByRole("button", { name: "Delete" }).click()

  await expect(page).not.toHaveURL(/task=/)
  await expect(page.getByRole("button", { name: /Draft launch notes/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Keep this one/ })).toBeVisible()
})
