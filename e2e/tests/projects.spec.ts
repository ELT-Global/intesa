import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember, pageAs } from "../support/members"
import { createProject as apiCreateProject, workspaceIdBySlug } from "../support/projects"

const projectsNav = (page: Page) => page.getByRole("region", { name: "Projects", exact: true })
const breadcrumb = (page: Page) => page.getByRole("navigation", { name: "Breadcrumb" })

async function createProject(page: Page, name: string, key?: string) {
  await page.getByRole("button", { name: "Add project" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Project name").fill(name)
  if (key) await dialog.getByLabel("Key (optional)").fill(key)
  await dialog.getByRole("button", { name: "Create project" }).click()
  await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/)
}

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  return createWorkspace(page, uniqueName())
}

test("create a project from the sidebar: lands on its board and shows in the tree", async ({
  page,
}) => {
  await setup(page)
  const name = uniqueName("Apollo")
  await createProject(page, name)

  await expect(breadcrumb(page)).toContainText(name)
  await expect(projectsNav(page).getByRole("link", { name })).toBeVisible()
  await expect(page.getByRole("button", { name: "New task" })).toBeVisible()
})

test("creation errors surface inline (duplicate key)", async ({ page }) => {
  await setup(page)
  await createProject(page, uniqueName("One"), "DUP")
  await page.getByRole("button", { name: "Add project" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Project name").fill(uniqueName("Two"))
  await dialog.getByLabel("Key (optional)").fill("DUP")
  await dialog.getByRole("button", { name: "Create project" }).click()
  await expect(dialog.getByRole("alert")).toBeVisible()
})

test("switching projects and views keeps the right project", async ({ page }) => {
  await setup(page)
  const first = uniqueName("Alpha")
  const second = uniqueName("Beta")
  await createProject(page, first)
  await createProject(page, second)
  await expect(breadcrumb(page)).toContainText(second)

  await projectsNav(page).getByRole("link", { name: first }).click()
  await expect(breadcrumb(page)).toContainText(first)
  const firstUrl = new URL(page.url()).pathname.replace(/\/board$/, "")

  await page.getByRole("button", { name: "Table" }).click()
  await expect(page).toHaveURL(new RegExp(`${firstUrl}/table$`))
  await expect(breadcrumb(page)).toContainText(first)

  await page.getByRole("button", { name: "Board" }).click()
  await expect(page).toHaveURL(new RegExp(`${firstUrl}/board$`))
})

test("project URL without a view redirects to the board", async ({ page }) => {
  await setup(page)
  await createProject(page, uniqueName("Redirect"))
  const base = new URL(page.url()).pathname.replace(/\/board$/, "")
  await page.goto(base)
  await expect(page).toHaveURL(new RegExp(`${base}/board$`))
})

test("editing the project name updates the sidebar", async ({ page }) => {
  await setup(page)
  const name = uniqueName("Before")
  const renamed = uniqueName("After")
  await createProject(page, name)

  await page.getByRole("button", { name: "Project options" }).click()
  await page.getByRole("menuitem", { name: "Project settings" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Project name").fill(renamed)
  await dialog.getByRole("button", { name: "Save" }).click()

  await expect(projectsNav(page).getByRole("link", { name: renamed })).toBeVisible()
  await expect(projectsNav(page).getByRole("link", { name })).toHaveCount(0)
  await expect(breadcrumb(page)).toContainText(renamed)
})

test("owner deletes a project after confirming: it disappears and they land home", async ({
  page,
}) => {
  const slug = await setup(page)
  const name = uniqueName("Doomed")
  await createProject(page, name)

  await page.getByRole("button", { name: "Project options" }).click()
  await page.getByRole("menuitem", { name: "Project settings" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Delete project" }).click()
  await dialog.getByRole("button", { name: "Confirm delete" }).click()

  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`))
  await expect(projectsNav(page).getByRole("link", { name })).toHaveCount(0)
})

test("home lists the workspace's projects", async ({ page }) => {
  await setup(page)
  const name = uniqueName("Listed")
  await createProject(page, name)
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Home" })
    .click()
  await expect(page.getByRole("main").getByRole("link", { name })).toBeVisible()
})

test("members do not see the delete control", async ({ page, browser }) => {
  const slug = await setup(page)
  const name = uniqueName("Shared")
  await createProject(page, name)
  const email = uniqueEmail("member")
  await addMember(page, await workspaceIdBySlug(page, slug), email)

  const memberPage = await pageAs(browser, email)
  await memberPage.goto(page.url())
  await memberPage.getByRole("button", { name: "Project options" }).click()
  await memberPage.getByRole("menuitem", { name: "Project settings" }).click()
  const dialog = memberPage.getByRole("dialog")
  await expect(dialog.getByLabel("Project name")).toHaveValue(name)
  await expect(dialog.getByRole("button", { name: "Delete project" })).toHaveCount(0)
})

test("a project id under another workspace's slug shows not-found", async ({ page }) => {
  const slugA = await setup(page)
  const project = await apiProject(page, slugA)
  const slugB = await createWorkspace(page, uniqueName())

  await page.goto(`/w/${slugB}/projects/${project.id}/board`)
  await expect(page.getByRole("heading", { name: "Project not found." })).toBeVisible()
})

async function apiProject(page: Page, slug: string) {
  return apiCreateProject(page, await workspaceIdBySlug(page, slug), uniqueName("Other"))
}

test("project links reopen the last used view", async ({ page }) => {
  await setup(page)
  const name = uniqueName("Remembered")
  await createProject(page, name)
  await page.getByRole("button", { name: "Table" }).click()
  await expect(page).toHaveURL(/\/table$/)

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Home" })
    .click()
  await projectsNav(page).getByRole("link", { name }).click()
  await expect(page).toHaveURL(/\/table$/)
})
