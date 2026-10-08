import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember } from "../support/members"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

type Member = { userId: string; email: string }

/** Owner plus one teammate, each with a task, on a project board with the default (own) filter. */
async function openBoard(page: Page) {
  const ownerEmail = uniqueEmail("owner")
  await signIn(page, { email: ownerEmail, name: "Olive Owner" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const bobEmail = uniqueEmail("bob")
  await addMember(page, workspaceId, bobEmail)
  const res = await page.request.get(`/api/workspaces/${workspaceId}/members`)
  const { members } = (await res.json()) as { members: Member[] }
  const olive = members.find((m) => m.email === ownerEmail) as Member
  const bob = members.find((m) => m.email === bobEmail) as Member
  const project = await createProject(page, workspaceId, uniqueName("Project"), {
    defaultFilter: true,
  })
  await createTaskViaApi(page, project.id, { title: "Mine", assigneeIds: [olive.userId] })
  await createTaskViaApi(page, project.id, { title: "Bobs", assigneeIds: [bob.userId] })
  await createTaskViaApi(page, project.id, { title: "Nobody", assigneeIds: [] })
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  await expect(task(page, "Mine")).toBeVisible()
  return { slug, projectId: project.id }
}

const task = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(title) })
const help = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" })
const search = (page: Page) => page.getByRole("combobox", { name: "Search tasks" })

test("Ctrl+/ toggles the shortcuts list, which names the platform's modifier", async ({ page }) => {
  await openBoard(page)
  await page.keyboard.press("Control+/")
  await expect(help(page)).toBeVisible()
  await expect(help(page).getByRole("region", { name: "Board" })).toBeVisible()
  await expect(help(page)).toContainText("Ctrl")

  await page.keyboard.press("Control+/")
  await expect(help(page)).toBeHidden()
})

test("the shortcuts list is also in the project options menu", async ({ page }) => {
  await openBoard(page)
  await page.getByRole("button", { name: "Project options" }).click()
  await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click()
  await expect(help(page)).toBeVisible()
})

test("F focuses the search field, and typing f there does not re-trigger it", async ({ page }) => {
  await openBoard(page)
  await page.keyboard.press("f")
  await expect(search(page)).toBeFocused()
  await page.keyboard.type("ff")
  await expect(search(page)).toHaveValue("ff")
})

test("N opens the new task dialog", async ({ page }) => {
  await openBoard(page)
  await page.keyboard.press("n")
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible()
})

test("B and T switch between the board and the table", async ({ page }) => {
  const { slug, projectId } = await openBoard(page)
  await page.keyboard.press("t")
  await expect(page).toHaveURL(`/w/${slug}/projects/${projectId}/table`)
  await page.keyboard.press("b")
  await expect(page).toHaveURL(`/w/${slug}/projects/${projectId}/board`)
})

test("Shift+Arrow steps through the assignee views and wraps", async ({ page }) => {
  await openBoard(page)
  // Starts on Me; the order is Me, Bob, Unassigned, Everyone.
  await expect(task(page, "Bobs")).toBeHidden()

  await page.keyboard.press("Shift+ArrowRight")
  await expect(task(page, "Bobs")).toBeVisible()
  await expect(task(page, "Mine")).toBeHidden()

  await page.keyboard.press("Shift+ArrowRight")
  await expect(task(page, "Nobody")).toBeVisible()
  await expect(task(page, "Bobs")).toBeHidden()

  await page.keyboard.press("Shift+ArrowRight")
  await expect(task(page, "Mine")).toBeVisible()
  await expect(task(page, "Bobs")).toBeVisible()

  await page.keyboard.press("Shift+ArrowRight")
  await expect(task(page, "Bobs")).toBeHidden()
  await page.keyboard.press("Shift+ArrowLeft")
  await expect(task(page, "Bobs")).toBeVisible()
})

test("shortcuts stay out of the way while typing", async ({ page }) => {
  await openBoard(page)
  await page.keyboard.press("f")
  await page.keyboard.type("nbt")
  await expect(search(page)).toHaveValue("nbt")
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("C still opens the new task dialog", async ({ page }) => {
  await openBoard(page)
  await page.keyboard.press("c")
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible()
})
