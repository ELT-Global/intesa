import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, workspaceIdBySlug } from "../support/projects"

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true })

async function openBoard(page: Page) {
  await signIn(page, { email: uniqueEmail(), name: "Ada Lovelace" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
}

test("the composer creates a task with every property in one go", async ({ page }) => {
  await openBoard(page)
  await page.getByRole("button", { name: "New task" }).click()
  const dialog = page.getByRole("dialog", { name: "New task" })

  await dialog.getByLabel("Title").fill("Ship the composer")
  await dialog.getByLabel("Description").fill("Everything is set before the task exists.")

  await dialog.getByRole("button", { name: "Change status" }).click()
  await page.getByRole("menuitemradio", { name: "In progress" }).click()
  await dialog.getByRole("button", { name: "Change priority" }).click()
  await page.getByRole("menuitemradio", { name: "High" }).click()

  await dialog.getByRole("button", { name: "Change assignees" }).click()
  await page.getByRole("option", { name: "Assign to me" }).click()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Assignees" })).toBeHidden()

  await dialog.getByRole("button", { name: "Add tag" }).click()
  await page.getByRole("combobox", { name: "Filter tags" }).fill("composer")
  await page.getByRole("option", { name: /Create tag/ }).click()
  await page.keyboard.press("Escape")
  await expect(dialog).toContainText("composer")

  // Enter in the date field commits the date; it must not submit the form.
  const due = dialog.getByLabel("Due date", { exact: true })
  await due.fill("2031-03-14")
  await due.press("Enter")
  await expect(dialog).toBeVisible()
  await expect(due).toHaveValue("2031-03-14")

  await dialog.getByLabel("Title").press("ControlOrMeta+Enter")
  await expect(dialog).toBeHidden()

  const card = column(page, "In progress").getByRole("button", { name: /Ship the composer/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText("High")
  await expect(card).toContainText("composer")
  await expect(card).toContainText("Mar 14")

  await card.click()
  const sheet = page.getByRole("dialog", { name: /-1$/ })
  await expect(sheet.getByRole("textbox", { name: "Description" })).toHaveValue(
    "Everything is set before the task exists.",
  )
  await expect(sheet.getByRole("button", { name: "Change assignees" })).toContainText("Ada")
})

test("Create more keeps the composer open and clears the text", async ({ page }) => {
  await openBoard(page)
  await page.getByRole("button", { name: "New task" }).click()
  const dialog = page.getByRole("dialog", { name: "New task" })
  await dialog.getByLabel("Create more").check()

  await dialog.getByLabel("Title").fill("First of two")
  await dialog.getByLabel("Description").fill("Some notes")
  await dialog.getByLabel("Title").press("Enter")
  await expect(dialog.getByRole("status")).toContainText(/Created .*-1\./)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel("Title")).toHaveValue("")
  await expect(dialog.getByLabel("Description")).toHaveValue("")
  await expect(dialog.getByLabel("Title")).toBeFocused()

  await dialog.getByLabel("Title").fill("Second of two")
  await dialog.getByLabel("Title").press("Enter")
  await expect(dialog.getByRole("status")).toContainText(/-2\./)

  // The board behind the open composer is inert, so look at it once the composer is closed.
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(column(page, "Todo").getByRole("button", { name: /Second of two/ })).toBeVisible()
  await expect(column(page, "Todo").getByRole("button", { name: /First of two/ })).toBeVisible()
})

test("a column's Add task starts the composer in that status", async ({ page }) => {
  await openBoard(page)
  await column(page, "Review").getByRole("button", { name: "Add task" }).click()
  const dialog = page.getByRole("dialog", { name: "New task" })
  await expect(dialog.getByRole("button", { name: "Change status" })).toContainText("Review")
})

test("Ctrl+Enter inside the date field submits the date just typed", async ({ page }) => {
  await openBoard(page)
  await page.getByRole("button", { name: "New task" }).click()
  const dialog = page.getByRole("dialog", { name: "New task" })
  await dialog.getByLabel("Title").fill("Dated at once")

  const due = dialog.getByLabel("Due date", { exact: true })
  await due.fill("2031-05-06")
  await due.press("ControlOrMeta+Enter")
  await expect(dialog).toBeHidden()

  const card = column(page, "Todo").getByRole("button", { name: /Dated at once/ })
  await expect(card).toContainText("May 6")
})

test("a failed create shows the error in the composer and keeps the draft", async ({ page }) => {
  await openBoard(page)
  await page.route(
    (url) => /\/api\/projects\/[^/]+\/tasks$/.test(url.pathname),
    (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "boom" } })
        : route.continue(),
  )
  await page.getByRole("button", { name: "New task" }).click()
  const dialog = page.getByRole("dialog", { name: "New task" })
  await dialog.getByLabel("Title").fill("Will not save")
  await dialog.getByLabel("Title").press("Enter")

  await expect(dialog.getByRole("alert")).toContainText("Could not create the task")
  await expect(dialog.getByLabel("Title")).toHaveValue("Will not save")
})
