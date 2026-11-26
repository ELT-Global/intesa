import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import {
  createProject,
  createTaskViaApi,
  setTaskStatus,
  workspaceIdBySlug,
} from "../support/projects"

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  return { project, board: `/w/${slug}/projects/${project.id}/board` }
}

const card = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(title) })

test("cards of blocked and blocking tasks show an hourglass listing the related tasks", async ({
  page,
}) => {
  const { project, board } = await setup(page)
  const blocker = await createTaskViaApi(page, project.id, { title: "Lay foundation" })
  const middle = await createTaskViaApi(page, project.id, { title: "Build walls" })
  const loner = await createTaskViaApi(page, project.id, { title: "Unrelated chore" })
  const link = async (taskId: string, type: string, otherId: string) =>
    expect(
      (
        await page.request.post(`/api/tasks/${taskId}/relationships`, {
          data: { type, taskId: otherId },
        })
      ).status(),
    ).toBe(201)
  await link(blocker.id, "blocks", middle.id)
  await page.goto(board)

  // Only tasks in a block relationship get the icon.
  await expect(card(page, "Unrelated chore").getByRole("img", { name: /Block/ })).toHaveCount(0)

  const blocked = card(page, "Build walls").getByRole("img", { name: "Blocked" })
  await expect(blocked).toBeVisible()
  await blocked.hover()
  const tip = page.getByRole("region", { name: "Blocked by" })
  await expect(tip).toContainText(blocker.key)
  await expect(tip).toContainText("Lay foundation")
  await expect(page.getByRole("region", { name: "Blocks" })).toHaveCount(0)

  await page.mouse.move(0, 0)
  await expect(tip).toHaveCount(0)

  // Keyboard focus shows it too, on the blocker's side.
  const blocking = card(page, "Lay foundation").getByRole("img", { name: "Blocking" })
  await blocking.focus()
  const blocksTip = page.getByRole("region", { name: "Blocks" })
  await expect(blocksTip).toContainText(middle.key)
  await expect(blocksTip).toContainText("Build walls")
  await blocking.blur()
  await expect(blocksTip).toHaveCount(0)

  // A task in the middle of a chain is both.
  await link(middle.id, "blocks", loner.id)
  await page.reload()
  await card(page, "Build walls").getByRole("img", { name: "Blocked and Blocking" }).hover()
  await expect(page.getByRole("region", { name: "Blocked by" })).toContainText(blocker.key)
  await expect(page.getByRole("region", { name: "Blocks" })).toContainText(loner.key)
})

test("the hourglass appears and disappears as relationships change from the task sheet", async ({
  page,
}) => {
  const { project, board } = await setup(page)
  const a = await createTaskViaApi(page, project.id, { title: "Alpha work" })
  const b = await createTaskViaApi(page, project.id, { title: "Bravo work" })
  await page.goto(`${board}?task=${a.id}`)

  const dialog = page.getByRole("dialog").first()
  await dialog.getByRole("button", { name: "Add relationship" }).click()
  await page.getByRole("button", { name: "Blocked by", exact: true }).click()
  await page.getByRole("combobox").fill("Bravo work")
  await page.getByRole("option", { name: new RegExp(b.key) }).click()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")

  await expect(card(page, "Alpha work").getByRole("img", { name: "Blocked" })).toBeVisible()
  await expect(card(page, "Bravo work").getByRole("img", { name: "Blocking" })).toBeVisible()

  await page.goto(`${board}?task=${a.id}`)
  await page
    .getByRole("dialog")
    .getByRole("group", { name: "Blocked by", exact: true })
    .getByRole("button", { name: `Remove ${b.key}` })
    .click()
  await page.keyboard.press("Escape")

  await expect(card(page, "Alpha work").getByRole("img", { name: /Block/ })).toHaveCount(0)
  await expect(card(page, "Bravo work").getByRole("img", { name: /Block/ })).toHaveCount(0)
})

test("a finished blocker stays listed, struck through", async ({ page }) => {
  const { project, board } = await setup(page)
  const blocker = await createTaskViaApi(page, project.id, { title: "Already shipped" })
  const task = await createTaskViaApi(page, project.id, { title: "Follow-up work" })
  await page.request.post(`/api/tasks/${blocker.id}/relationships`, {
    data: { type: "blocks", taskId: task.id },
  })
  await setTaskStatus(page, blocker.id, "complete")
  await page.goto(board)
  await card(page, "Follow-up work").getByRole("img", { name: "Blocked" }).hover()
  const item = page.getByRole("region", { name: "Blocked by" }).getByRole("listitem")
  await expect(item).toContainText(blocker.key)
  await expect(item).toHaveCSS("text-decoration-line", "line-through")
})
