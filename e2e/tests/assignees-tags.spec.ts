import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember } from "../support/members"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail("owner"), name: "Olive Owner" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const memberEmail = uniqueEmail("teammate")
  await addMember(page, workspaceId, memberEmail)
  const projectA = await createProject(page, workspaceId, uniqueName("Alpha"))
  const projectB = await createProject(page, workspaceId, uniqueName("Beta"))
  await createTaskViaApi(page, projectA.id, { title: "Task in A" })
  await createTaskViaApi(page, projectB.id, { title: "Task in B" })
  return { slug, memberEmail, projectA, projectB }
}

const board = (slug: string, projectId: string) => `/w/${slug}/projects/${projectId}/board`
const card = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(title) })
const sheet = (page: Page) => page.getByRole("dialog", { name: /-1$/ })

test("assign and unassign people; avatars persist on the card; Assign to me", async ({ page }) => {
  const { slug, memberEmail, projectA } = await setup(page)
  await page.goto(board(slug, projectA.id))
  await card(page, "Task in A").click()

  await sheet(page).getByRole("button", { name: "Change assignees" }).click()
  const popover = page.getByRole("dialog", { name: "Assignees" })
  await popover.getByRole("option", { name: /Olive Owner/ }).click()
  await popover.getByRole("option", { name: new RegExp(memberEmail) }).click()
  await expect(popover.getByRole("option", { selected: true })).toHaveCount(2)
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")

  await expect(card(page, "Task in A")).toContainText("OO")
  await page.waitForLoadState("networkidle")
  await page.reload()
  await expect(card(page, "Task in A")).toContainText("OO")
  await expect(card(page, "Task in A").locator("span.rounded-full")).toHaveCount(2)

  // Unassign the teammate through the keyboard-operable filter.
  await card(page, "Task in A").click()
  await sheet(page).getByRole("button", { name: "Change assignees" }).click()
  await popover.getByRole("combobox").fill(memberEmail.split("@")[0] as string)
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await expect(card(page, "Task in A").locator("span.rounded-full")).toHaveCount(1)

  // Clear everyone, then use the shortcut.
  await card(page, "Task in A").click()
  await sheet(page).getByRole("button", { name: "Change assignees" }).click()
  await popover.getByRole("option", { name: /Olive Owner/ }).click()
  await expect(popover.getByRole("option", { selected: true })).toHaveCount(0)
  await popover.getByRole("button", { name: "Assign to me" }).click()
  await expect(popover.getByRole("option", { selected: true })).toHaveCount(1)
  await expect(popover.getByRole("option", { name: /Olive Owner/, selected: true })).toBeVisible()
})

test("create a tag from the picker, reuse it in another project, then remove it", async ({
  page,
}) => {
  const { slug, projectA, projectB } = await setup(page)
  await page.goto(board(slug, projectA.id))
  await card(page, "Task in A").click()

  await sheet(page).getByRole("button", { name: "Add tag" }).click()
  const popover = page.getByRole("dialog", { name: "Tags" })
  await popover.getByRole("combobox").fill("Frontend")
  await popover.getByRole("option", { name: "Create tag “Frontend”" }).click()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await expect(card(page, "Task in A")).toContainText("Frontend")

  await page.goto(board(slug, projectB.id))
  await card(page, "Task in B").click()
  await sheet(page).getByRole("button", { name: "Add tag" }).click()
  await popover.getByRole("combobox").fill("frontend")
  await expect(popover.getByRole("option", { name: /Create tag/ })).toHaveCount(0)
  await popover.getByRole("option", { name: "Frontend" }).click()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await expect(card(page, "Task in B")).toContainText("Frontend")

  await page.waitForLoadState("networkidle")
  await page.reload()
  await card(page, "Task in B").click()
  await sheet(page).getByRole("button", { name: "Remove tag Frontend" }).click()
  await page.keyboard.press("Escape")
  await expect(card(page, "Task in B")).not.toContainText("Frontend")
  await page.waitForLoadState("networkidle")
  await page.reload()
  await expect(card(page, "Task in B")).not.toContainText("Frontend")
})
