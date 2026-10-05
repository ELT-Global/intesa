import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember, pageAs } from "../support/members"
import { workspaceIdBySlug } from "../support/projects"
import { style, tokenValue } from "../support/styles"

async function ownerWorkspace(page: Page) {
  await signIn(page, { email: uniqueEmail("owner"), name: "Olive Owner" })
  const name = uniqueName()
  const slug = await createWorkspace(page, name)
  return { name, slug, id: await workspaceIdBySlug(page, slug) }
}

const row = (page: Page, email: string) => page.getByRole("row", { name: new RegExp(email) })
const actions = (page: Page, email: string) =>
  row(page, email).getByRole("button", { name: /Actions for/ })

test("owner adds a member by email; they see the workspace and can open it", async ({
  page,
  browser,
}) => {
  const { name, slug } = await ownerWorkspace(page)
  const email = uniqueEmail("member")

  await page.goto(`/w/${slug}/members`)
  await page.getByRole("button", { name: "Add member" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email").fill(email)
  await dialog.getByRole("button", { name: "Add member" }).click()
  await expect(row(page, email)).toBeVisible()

  const memberPage = await pageAs(browser, email)
  await memberPage.goto("/")
  await expect(memberPage.getByRole("button", { name: "Switch workspace" })).toContainText(name)
  await memberPage.goto(`/w/${slug}/home`)
  await expect(memberPage).toHaveURL(new RegExp(`/w/${slug}/home$`))
  await expect(memberPage.getByRole("button", { name: "Switch workspace" })).toContainText(name)
})

test("adding the same email twice shows the API error inline", async ({ page }) => {
  const { slug, id } = await ownerWorkspace(page)
  const email = uniqueEmail("dup")
  await addMember(page, id, email)

  await page.goto(`/w/${slug}/members`)
  await page.getByRole("button", { name: "Add member" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email").fill(email)
  await dialog.getByRole("button", { name: "Add member" }).click()
  await expect(dialog.getByRole("alert")).toBeVisible()
})

test("owner changes a member role", async ({ page }) => {
  const { slug, id } = await ownerWorkspace(page)
  const email = uniqueEmail("promote")
  await addMember(page, id, email)

  await page.goto(`/w/${slug}/members`)
  await expect(row(page, email)).not.toContainText("Owner")
  await actions(page, email).click()
  await page.getByRole("menuitem", { name: "Make owner" }).click()
  await expect(row(page, email)).toContainText("Owner")

  await actions(page, email).click()
  await expect(page.getByRole("menuitem", { name: "Make member" })).toBeVisible()
})

test("a plain member sees no owner controls", async ({ page, browser }) => {
  const { slug, id } = await ownerWorkspace(page)
  const email = uniqueEmail("plain")
  await addMember(page, id, email)

  const memberPage = await pageAs(browser, email)
  await memberPage.goto(`/w/${slug}/members`)
  await expect(row(memberPage, email)).toBeVisible()
  await expect(memberPage.getByRole("button", { name: "Add member" })).toHaveCount(0)
  await expect(memberPage.getByRole("button", { name: /Actions for/ })).toHaveCount(0)
  await expect(memberPage.getByRole("button", { name: "Leave workspace" })).toBeVisible()
})

test("removing a member revokes their access", async ({ page, browser }) => {
  const { slug, id } = await ownerWorkspace(page)
  const email = uniqueEmail("removed")
  await addMember(page, id, email)
  const memberPage = await pageAs(browser, email)
  await memberPage.goto(`/w/${slug}/home`)
  await expect(memberPage).toHaveURL(new RegExp(`/w/${slug}/home$`))

  await page.goto(`/w/${slug}/members`)
  await actions(page, email).click()
  await page.getByRole("menuitem", { name: "Remove" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click()
  await expect(row(page, email)).toHaveCount(0)

  await memberPage.reload()
  await expect(memberPage.getByRole("heading", { name: "Workspace not found." })).toBeVisible()
})

test("the last owner cannot leave", async ({ page }) => {
  const { slug } = await ownerWorkspace(page)
  await page.goto(`/w/${slug}/members`)
  await page.getByRole("button", { name: "Leave workspace" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Leave", exact: true }).click()
  await expect(dialog.getByRole("alert")).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/members$`))
})

test("a member can leave the workspace", async ({ page, browser }) => {
  const { slug, id } = await ownerWorkspace(page)
  const email = uniqueEmail("leaver")
  await addMember(page, id, email)

  const memberPage = await pageAs(browser, email)
  await memberPage.goto(`/w/${slug}/members`)
  await memberPage.getByRole("button", { name: "Leave workspace" }).click()
  await memberPage.getByRole("dialog").getByRole("button", { name: "Leave", exact: true }).click()
  await expect(memberPage).toHaveURL(/\/new-workspace$/)
})

test("members table: Owner chip only on owners, primary Add member, placeholder listed by email name", async ({
  page,
}) => {
  const { slug, id } = await ownerWorkspace(page)
  const local = `ada.lovelace-${uniqueEmail("x").slice(2, 10)}`
  const email = `${local}@example.test`
  await addMember(page, id, email)

  await page.goto(`/w/${slug}/members`)
  const table = page.getByRole("table")
  await expect(row(page, email)).toContainText(local) // name derived from the email
  await expect(row(page, email)).not.toContainText("Owner")
  await expect(row(page, "owner-")).toContainText("Owner")
  await expect(table.getByText("Owner", { exact: true })).toHaveCount(1)

  const bg = (name: string) => style(page.getByRole("button", { name }), "background-color")
  const primary = await tokenValue(page, "--primary", "backgroundColor")
  expect(await bg("Add member")).toBe(primary)
  expect(await bg("Leave workspace")).not.toBe(primary)
})
