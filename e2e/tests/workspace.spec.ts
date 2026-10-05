import { expect, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"

test("create a workspace, see the shell, survive a reload", async ({ page }) => {
  await signIn(page, { email: uniqueEmail() })
  const name = uniqueName()
  const slug = await createWorkspace(page, name)

  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`))
  await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(name)
  const nav = page.getByRole("navigation", { name: "Primary" })
  for (const label of ["Home", "My Tasks", "Members"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible()
  }

  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`))
  await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(name)
})

test("switching workspaces changes the URL", async ({ page }) => {
  await signIn(page, { email: uniqueEmail() })
  const first = uniqueName("Alpha")
  const firstSlug = await createWorkspace(page, first)
  const secondSlug = await createWorkspace(page, uniqueName("Beta"))
  expect(secondSlug).not.toBe(firstSlug)

  await page.getByRole("button", { name: "Switch workspace" }).click()
  await page.getByRole("menuitem", { name: first }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${firstSlug}/home$`))
  await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(first)
})

test("/ returns to the last used workspace", async ({ page }) => {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  await page.goto("/")
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`))
})

test("unknown workspace slug shows a not-found state", async ({ page }) => {
  await signIn(page, { email: uniqueEmail() })
  await createWorkspace(page, uniqueName())
  await page.goto("/w/does-not-exist/home")
  await expect(page.getByRole("heading", { name: "Workspace not found." })).toBeVisible()
  await expect(page.getByRole("link", { name: "Go home" })).toBeVisible()
})
