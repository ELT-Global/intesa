import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

async function setup(
  page: Page,
  tasks: { title: string; status?: string }[],
  beforeGoto?: () => Promise<void>,
) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  for (const t of tasks) await createTaskViaApi(page, project.id, t)
  await beforeGoto?.()
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
}

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true })

test("tasks appear in the column for their status", async ({ page }) => {
  await setup(page, [
    { title: "Sketch ideas", status: "backlog" },
    { title: "Write spec" },
    { title: "Build it", status: "in_progress" },
    { title: "Ship it", status: "complete" },
  ])
  for (const name of ["Backlog", "Todo", "In Progress", "Review", "Complete"]) {
    await expect(column(page, name)).toBeVisible()
  }
  await expect(column(page, "Backlog").getByRole("button", { name: /Sketch ideas/ })).toBeVisible()
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toBeVisible()
  await expect(column(page, "In Progress").getByRole("button", { name: /Build it/ })).toBeVisible()
  await expect(column(page, "Complete").getByRole("button", { name: /Ship it/ })).toBeVisible()
  await expect(column(page, "Review").getByRole("listitem")).toHaveCount(0)
})

test("dragging a card to another column changes its status and persists", async ({ page }) => {
  await setup(page, [{ title: "Write spec" }])
  const card = column(page, "Todo").getByRole("button", { name: /Write spec/ })
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok())
  await card.dragTo(column(page, "In Progress"))

  await expect(
    column(page, "In Progress").getByRole("button", { name: /Write spec/ }),
  ).toBeVisible()
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toHaveCount(0)

  await saved
  await page.reload()
  await expect(
    column(page, "In Progress").getByRole("button", { name: /Write spec/ }),
  ).toBeVisible()

  await column(page, "In Progress")
    .getByRole("button", { name: /Write spec/ })
    .click()
  const sheet = page.getByRole("dialog", { name: /-1$/ })
  await sheet.getByRole("button", { name: "History" }).click()
  await expect(sheet.getByRole("list", { name: "History" })).toContainText("Todo → In Progress")
})

test("a column's add button creates a task in that column", async ({ page }) => {
  await setup(page, [])
  await column(page, "Review").getByRole("button", { name: "Add task" }).click()
  const dialog = page.getByRole("dialog", { name: "New task" })
  await dialog.getByLabel("Title").fill("Review the draft")
  await page.keyboard.press("Enter")
  await expect(
    column(page, "Review").getByRole("button", { name: /Review the draft/ }),
  ).toBeVisible()
})

test("a failed move rolls back and shows the error", async ({ page }) => {
  await setup(page, [{ title: "Write spec" }])
  await page.route("**/api/tasks/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "boom" } })
      : route.continue(),
  )
  await column(page, "Todo")
    .getByRole("button", { name: /Write spec/ })
    .dragTo(column(page, "In Progress"))

  await expect(page.getByRole("alert")).toContainText("Could not save the task.")
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toBeVisible()
  await expect(column(page, "In Progress").getByRole("button", { name: /Write spec/ })).toHaveCount(
    0,
  )
})

test("Alt+Arrow keys move a focused card one column and keep focus", async ({ page }) => {
  await setup(page, [{ title: "Write spec" }])
  const card = column(page, "Todo").getByRole("button", { name: /Write spec/ })
  await card.focus()

  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok())
  await page.keyboard.press("Alt+ArrowRight")
  const moved = column(page, "In Progress").getByRole("button", { name: /Write spec/ })
  await expect(moved).toBeVisible()
  await expect(moved).toBeFocused()
  await saved

  await page.keyboard.press("Alt+ArrowLeft")
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toBeFocused()

  // Backlog is the first column, so there is nothing further left.
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(column(page, "Backlog").getByRole("button", { name: /Write spec/ })).toBeFocused()
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(column(page, "Backlog").getByRole("button", { name: /Write spec/ })).toBeVisible()
})

const isTaskList = (url: URL, method: string) =>
  method === "GET" && /\/api\/projects\/[^/]+\/tasks$/.test(url.pathname)

test("column shells show while tasks load", async ({ page }) => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await setup(page, [{ title: "Write spec" }], async () => {
    await page.route(
      (url) => isTaskList(url, "GET"),
      async (route) => {
        await gate
        await route.continue()
      },
    )
  })

  for (const name of ["Backlog", "Todo", "In Progress", "Review", "Complete"]) {
    await expect(column(page, name)).toBeVisible()
  }
  await expect(page.getByRole("button", { name: /Write spec/ })).toHaveCount(0)

  release()
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toBeVisible()
})

test("a failed task load shows an error and Try again recovers", async ({ page }) => {
  let failing = true
  await setup(page, [{ title: "Write spec" }], async () => {
    await page.route(
      (url) => isTaskList(url, "GET"),
      (route) =>
        failing
          ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "boom" } })
          : route.continue(),
    )
  })

  await expect(page.getByRole("alert")).toContainText("Something went wrong")
  failing = false
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toBeVisible()
})
