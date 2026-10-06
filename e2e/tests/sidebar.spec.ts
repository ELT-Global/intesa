import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, workspaceIdBySlug } from "../support/projects"

const nav = (page: Page) => page.getByRole("navigation", { name: "Primary" })

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  return { slug, workspaceId: await workspaceIdBySlug(page, slug) }
}

test("the sidebar collapses and expands from the top bar button", async ({ page }) => {
  await setup(page)
  await expect(nav(page)).toBeVisible()

  const toggle = page.getByRole("button", { name: "Toggle sidebar" })
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await toggle.click()
  await expect(nav(page)).toBeHidden()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")

  await toggle.click()
  await expect(nav(page)).toBeVisible()
})

test("the sidebar header button collapses it too", async ({ page }) => {
  await setup(page)
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await expect(nav(page)).toBeHidden()
})

test("[ toggles the sidebar, except while typing", async ({ page }) => {
  const { slug } = await setup(page)
  await page.goto(`/w/${slug}/members`)
  await expect(nav(page)).toBeVisible()

  await page.keyboard.press("[")
  await expect(nav(page)).toBeHidden()
  await page.keyboard.press("[")
  await expect(nav(page)).toBeVisible()

  await page.getByRole("button", { name: "Add member" }).click()
  const email = page.getByRole("dialog").getByLabel("Email")
  await email.focus()
  await page.keyboard.type("[")
  await expect(email).toHaveValue("[")
  // The open dialog makes the page behind it inert for role queries, so check the element itself.
  await expect(page.locator('nav[aria-label="Primary"]')).toBeVisible()
})

test("the collapsed state survives a reload", async ({ page }) => {
  const { slug } = await setup(page)
  await page.getByRole("button", { name: "Toggle sidebar" }).click()
  await expect(nav(page)).toBeHidden()

  await page.goto(`/w/${slug}/home`)
  await expect(page.getByRole("heading", { name: "Home." })).toBeVisible()
  await expect(nav(page)).toBeHidden()
})

test("the board gets the freed space", async ({ page }) => {
  const { slug, workspaceId } = await setup(page)
  const project = await createProject(page, workspaceId, uniqueName("Wide"))
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  const main = page.getByRole("main")
  await expect(main).toBeVisible()
  const before = (await main.boundingBox())?.width ?? 0

  await page.getByRole("button", { name: "Toggle sidebar" }).click()
  await expect(nav(page)).toBeHidden()
  await expect
    .poll(async () => (await main.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before + 200)
})
