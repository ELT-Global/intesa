import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true })
const dialog = (page: Page) => page.getByRole("dialog", { name: "Update subtasks?" })

/** A board with one parent in Todo and one subtask per entry of `statuses`, named "Sub 1", "Sub 2"… */
async function setup(page: Page, statuses: string[]) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  const parent = await createTaskViaApi(page, project.id, { title: "Parent task" })
  for (const [i, status] of statuses.entries()) {
    const res = await page.request.post(`/api/projects/${project.id}/tasks`, {
      data: { title: `Sub ${i + 1}`, status, parentTaskId: parent.id },
    })
    expect(res.status()).toBe(201)
  }
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  const card = (col: string) => column(page, col).getByRole("button", { name: /Parent task/ })
  const subtaskStatuses = async () => {
    const res = await page.request.get(`/api/tasks/${parent.id}`)
    const { task } = (await res.json()) as {
      task: { subtasks: { title: string; status: string }[] }
    }
    return Object.fromEntries(task.subtasks.map((s) => [s.title, s.status]))
  }
  return { card, subtaskStatuses }
}

const statusButton = (page: Page, title: string) =>
  dialog(page).getByRole("button", { name: `Status of ${title}` })

test("moving a task with subtasks asks about them, and 'Set all' updates every subtask", async ({
  page,
}) => {
  const { card, subtaskStatuses } = await setup(page, ["todo", "complete"])
  await card("Todo").dragTo(column(page, "In progress"))

  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText("moved to In progress")
  await expect(statusButton(page, "Sub 1")).toContainText("Todo")
  await expect(statusButton(page, "Sub 2")).toContainText("Complete")
  // Nothing is changed yet, so there is nothing to save.
  await expect(dialog(page).getByRole("button", { name: "Update", exact: true })).toBeDisabled()

  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().includes("/api/tasks/") && r.ok(),
  )
  await dialog(page).getByRole("button", { name: "Set all to In progress" }).click()
  await expect(statusButton(page, "Sub 1")).toContainText("In progress")
  await expect(statusButton(page, "Sub 2")).toContainText("In progress")
  await dialog(page).getByRole("button", { name: "Update 2 subtasks" }).click()
  await expect(dialog(page)).toHaveCount(0)
  await saved

  await expect.poll(subtaskStatuses).toEqual({ "Sub 1": "in_progress", "Sub 2": "in_progress" })
  // The task stays where it was dropped.
  await expect(card("In progress")).toBeVisible()
})

test("subtasks can be given their own states in the dialog; only changed ones are saved", async ({
  page,
}) => {
  const { card, subtaskStatuses } = await setup(page, ["todo", "todo"])
  const patched: string[] = []
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/api/tasks/")) patched.push(r.url())
  })
  await card("Todo").dragTo(column(page, "In progress"))

  await statusButton(page, "Sub 2").click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()
  await expect(statusButton(page, "Sub 1")).toContainText("Todo")
  await expect(statusButton(page, "Sub 2")).toContainText("Complete")
  await dialog(page).getByRole("button", { name: "Update 1 subtask" }).click()

  await expect.poll(subtaskStatuses).toEqual({ "Sub 1": "todo", "Sub 2": "complete" })
  // One write for the task's own move, one for the subtask that was changed.
  expect(patched).toHaveLength(2)
})

test("'Leave as is' keeps the subtasks as they were", async ({ page }) => {
  const { card, subtaskStatuses } = await setup(page, ["todo"])
  await card("Todo").dragTo(column(page, "In progress"))
  await dialog(page).getByRole("button", { name: "Leave as is" }).click()
  await expect(dialog(page)).toHaveCount(0)

  await expect(card("In progress")).toBeVisible()
  await page.reload()
  await expect(card("In progress")).toBeVisible()
  expect(await subtaskStatuses()).toEqual({ "Sub 1": "todo" })
})

test("Alt+Arrow moves ask too, and Escape counts as leaving the subtasks alone", async ({
  page,
}) => {
  const { card, subtaskStatuses } = await setup(page, ["todo"])
  await card("Todo").focus()
  await page.keyboard.press("Alt+ArrowRight")

  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog(page)).toHaveCount(0)
  await expect(card("In progress")).toBeVisible()
  expect(await subtaskStatuses()).toEqual({ "Sub 1": "todo" })
})

test("no dialog when the subtasks already match the new column", async ({ page }) => {
  const { card } = await setup(page, ["in_progress", "in_progress"])
  // The subtasks are loaded after the move; the dialog would open once they arrive.
  const loaded = page.waitForResponse(
    (r) => r.request().method() === "GET" && /\/api\/tasks\/[^/]+$/.test(r.url()),
  )
  await card("Todo").dragTo(column(page, "In progress"))
  await loaded
  await expect(card("In progress")).toBeVisible()
  await expect(dialog(page)).toHaveCount(0)
})

test("no dialog for a task without subtasks", async ({ page }) => {
  const { card } = await setup(page, [])
  await card("Todo").dragTo(column(page, "In progress"))
  await expect(card("In progress")).toBeVisible()
  await expect(dialog(page)).toHaveCount(0)
})

test("no dialog when a card is only reordered within its column", async ({ page }) => {
  const { card } = await setup(page, ["todo"])
  const body = column(page, "Todo").locator("[data-column-body]")
  const box = await body.boundingBox()
  if (!box) throw new Error("column body not found")
  await card("Todo").dragTo(body, { targetPosition: { x: box.width / 2, y: box.height - 4 } })
  await expect(card("Todo")).toBeVisible()
  await expect(dialog(page)).toHaveCount(0)
})
