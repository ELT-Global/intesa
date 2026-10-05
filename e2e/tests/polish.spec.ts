import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, workspaceIdBySlug } from "../support/projects"

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  return { slug, workspaceId: await workspaceIdBySlug(page, slug) }
}

test("pressing c on a project page opens New task, but not while typing", async ({ page }) => {
  const { slug, workspaceId } = await setup(page)
  const project = await createProject(page, workspaceId, uniqueName("Keys"))
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  await expect(page.getByRole("button", { name: "New task" })).toBeVisible()

  await page.keyboard.press("c")
  const dialog = page.getByRole("dialog", { name: "New task" })
  await expect(dialog).toBeVisible()

  // Typing the letter inside a field must reach the field, not re-trigger the shortcut.
  await dialog.getByLabel("Title").fill("")
  await page.keyboard.type("cc")
  await expect(dialog.getByLabel("Title")).toHaveValue("cc")
})

test("a failing API call shows a retryable error, not a blank page", async ({ page }) => {
  const { slug } = await setup(page)
  const failing = /\/api\/workspaces\/[^/]+\/home/
  await page.route(failing, (route) =>
    route.fulfill({ status: 500, json: { code: "INTERNAL", message: "stack trace here" } }),
  )
  await page.goto(`/w/${slug}/home`)

  const alert = page.getByRole("alert")
  await expect(alert).toContainText("Couldn't load this.")
  await expect(alert).not.toContainText("stack trace")

  await page.unroute(failing)
  await alert.getByRole("button", { name: "Try again" }).click()
  await expect(page.getByRole("region", { name: "Assigned to you" })).toBeVisible()
})

test("the skip link moves focus to the main content", async ({ page }) => {
  const { slug } = await setup(page)
  await page.goto(`/w/${slug}/home`)
  await expect(page.getByRole("heading", { name: "Home." })).toBeVisible()

  await page.keyboard.press("Tab")
  const skip = page.getByRole("button", { name: "Skip to content" })
  await expect(skip).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.locator("#main")).toBeFocused()
})

test("a dialog opened from a menu returns focus to the menu button on close", async ({ page }) => {
  const { slug, workspaceId } = await setup(page)
  const project = await createProject(page, workspaceId, uniqueName("Focus"))
  await page.goto(`/w/${slug}/projects/${project.id}/board`)

  await page.getByRole("button", { name: "Project options" }).click()
  await page.getByRole("menuitem", { name: "Project settings" }).click()
  await expect(page.getByRole("dialog", { name: "Project settings." })).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(page.getByRole("button", { name: "Project options" })).toBeFocused()
})
