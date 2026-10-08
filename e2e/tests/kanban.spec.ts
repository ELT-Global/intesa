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
  for (const name of ["Backlog", "Todo", "In progress", "Review", "Complete"]) {
    await expect(column(page, name)).toBeVisible()
  }
  await expect(column(page, "Backlog").getByRole("button", { name: /Sketch ideas/ })).toBeVisible()
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toBeVisible()
  await expect(column(page, "In progress").getByRole("button", { name: /Build it/ })).toBeVisible()
  await expect(column(page, "Complete").getByRole("button", { name: /Ship it/ })).toBeVisible()
  await expect(column(page, "Review").getByRole("listitem")).toHaveCount(0)
})

test("dragging a card to another column changes its status and persists", async ({ page }) => {
  await setup(page, [{ title: "Write spec" }])
  const card = column(page, "Todo").getByRole("button", { name: /Write spec/ })
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok())
  await card.dragTo(column(page, "In progress"))

  await expect(
    column(page, "In progress").getByRole("button", { name: /Write spec/ }),
  ).toBeVisible()
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toHaveCount(0)

  await saved
  await page.reload()
  await expect(
    column(page, "In progress").getByRole("button", { name: /Write spec/ }),
  ).toBeVisible()

  await column(page, "In progress")
    .getByRole("button", { name: /Write spec/ })
    .click()
  const sheet = page.getByRole("dialog", { name: /-1$/ })
  await sheet.getByRole("button", { name: "History" }).click()
  await expect(sheet.getByRole("list", { name: "History" })).toContainText("Todo → In progress")
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
    .dragTo(column(page, "In progress"))

  await expect(page.getByRole("alert")).toContainText("Could not save the task.")
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toBeVisible()
  await expect(column(page, "In progress").getByRole("button", { name: /Write spec/ })).toHaveCount(
    0,
  )
})

test("Alt+Arrow keys move a focused card one column and keep focus", async ({ page }) => {
  await setup(page, [{ title: "Write spec" }])
  const patches: string[] = []
  await page.route("**/api/tasks/*", (route) => {
    if (route.request().method() === "PATCH") patches.push(route.request().url())
    return route.continue()
  })
  const card = column(page, "Todo").getByRole("button", { name: /Write spec/ })
  await card.focus()

  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok())
  await page.keyboard.press("Alt+ArrowRight")
  const moved = column(page, "In progress").getByRole("button", { name: /Write spec/ })
  await expect(moved).toBeVisible()
  await expect(moved).toBeFocused()
  await saved

  await page.keyboard.press("Alt+ArrowLeft")
  await expect(column(page, "Todo").getByRole("button", { name: /Write spec/ })).toBeFocused()

  // Backlog is the first column, so there is nothing further left.
  await page.keyboard.press("Alt+ArrowLeft")
  const backlogCard = column(page, "Backlog").getByRole("button", { name: /Write spec/ })
  await expect(backlogCard).toBeFocused()
  // Edits to one task are sent one after another, so wait for the third request to go out.
  await expect.poll(() => patches.length).toBe(3)

  const sentBefore = patches.length
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(page.getByRole("status").filter({ hasText: "already in Backlog" })).toBeVisible()
  await expect(backlogCard).toBeFocused()
  // A request round-trip after the keypress: anything the keypress had sent is counted by now.
  await page.evaluate(() => fetch("/api/health"))
  expect(patches.length).toBe(sentBefore)
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

  for (const name of ["Backlog", "Todo", "In progress", "Review", "Complete"]) {
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

// Card titles in a column, top to bottom.
const cards = (page: Page, name: string) => column(page, name).locator("li[data-task-id]")

test("new cards go to the top of their column", async ({ page }) => {
  await setup(page, [{ title: "First" }, { title: "Second" }, { title: "Third" }])
  await expect(cards(page, "Todo")).toContainText(["Third", "Second", "First"])
})

test("dragging a card within its column reorders it and persists", async ({ page }) => {
  await setup(page, [{ title: "A" }, { title: "B" }, { title: "C" }])
  await expect(cards(page, "Todo")).toContainText(["C", "B", "A"])

  // Drop on the upper half of C: A goes above it.
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok())
  await cards(page, "Todo")
    .getByRole("button", { name: /\bA\b/ })
    .dragTo(cards(page, "Todo").getByRole("button", { name: /\bC\b/ }), {
      targetPosition: { x: 40, y: 4 },
    })
  await expect(cards(page, "Todo")).toContainText(["A", "C", "B"])
  await saved

  await page.reload()
  await expect(cards(page, "Todo")).toContainText(["A", "C", "B"])
})

test("dropping below the last card of a column moves the card to the end", async ({ page }) => {
  await setup(page, [{ title: "A" }, { title: "B" }, { title: "C" }])
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok())
  const body = column(page, "Todo").locator("[data-column-body]")
  const box = await body.boundingBox()
  if (!box) throw new Error("column has no box")
  await cards(page, "Todo")
    .getByRole("button", { name: /\bC\b/ })
    .dragTo(body, { targetPosition: { x: box.width / 2, y: box.height - 4 } })
  await expect(cards(page, "Todo")).toContainText(["B", "A", "C"])
  await saved
  await page.reload()
  await expect(cards(page, "Todo")).toContainText(["B", "A", "C"])
})

test("dropping a card between two cards of another column places it there", async ({ page }) => {
  await setup(page, [
    { title: "Mover" },
    { title: "Low", status: "review" },
    { title: "High", status: "review" },
  ])
  await expect(cards(page, "Review")).toContainText(["High", "Low"])

  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok())
  await cards(page, "Todo")
    .getByRole("button", { name: /Mover/ })
    .dragTo(cards(page, "Review").getByRole("button", { name: /Low/ }), {
      targetPosition: { x: 40, y: 4 },
    })
  await expect(cards(page, "Review")).toContainText(["High", "Mover", "Low"])
  await expect(cards(page, "Todo")).toHaveCount(0)
  await saved

  await page.reload()
  await expect(cards(page, "Review")).toContainText(["High", "Mover", "Low"])
})

test("a failed reorder puts the card back", async ({ page }) => {
  await setup(page, [{ title: "A" }, { title: "B" }, { title: "C" }])
  await page.route("**/api/tasks/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "boom" } })
      : route.continue(),
  )
  await cards(page, "Todo")
    .getByRole("button", { name: /\bA\b/ })
    .dragTo(cards(page, "Todo").getByRole("button", { name: /\bC\b/ }), {
      targetPosition: { x: 40, y: 4 },
    })
  await expect(page.getByRole("alert")).toContainText("Could not save the task.")
  await expect(cards(page, "Todo")).toContainText(["C", "B", "A"])
})

test("Alt+Up and Alt+Down reorder a focused card within its column and keep focus", async ({
  page,
}) => {
  await setup(page, [{ title: "A" }, { title: "B" }, { title: "C" }])
  await expect(cards(page, "Todo")).toContainText(["C", "B", "A"])
  let saved = 0
  page.on("response", (r) => {
    if (r.request().method() === "PATCH" && r.ok()) saved++
  })
  const b = column(page, "Todo").getByRole("button", { name: /\bB\b/ })
  await b.focus()

  await page.keyboard.press("Alt+ArrowUp")
  await expect(cards(page, "Todo")).toContainText(["B", "C", "A"])
  await expect(b).toBeFocused()
  await expect(page.getByRole("status").filter({ hasText: "position 1 of 3" })).toBeVisible()

  // Already first: nothing to do, and the card is still focused.
  await page.keyboard.press("Alt+ArrowUp")
  await expect(page.getByRole("status").filter({ hasText: "already the first card" })).toBeVisible()
  await expect(b).toBeFocused()

  await page.keyboard.press("Alt+ArrowDown")
  await expect(cards(page, "Todo")).toContainText(["C", "B", "A"])
  await expect(b).toBeFocused()
  await page.keyboard.press("Alt+ArrowDown")
  await expect(cards(page, "Todo")).toContainText(["C", "A", "B"])
  await expect(b).toBeFocused()

  await page.keyboard.press("Alt+ArrowDown")
  await expect(page.getByRole("status").filter({ hasText: "already the last card" })).toBeVisible()
  // One save per move; the presses at either end sent nothing.
  await expect.poll(() => saved).toBe(3)
  await page.reload()
  await expect(cards(page, "Todo")).toContainText(["C", "A", "B"])
})

test("dropping a card where it already is sends nothing", async ({ page }) => {
  await setup(page, [{ title: "A" }, { title: "B" }, { title: "C" }])
  let patches = 0
  await page.route("**/api/tasks/*", (route) => {
    if (route.request().method() === "PATCH") patches++
    return route.continue()
  })
  // B sits between C and A; dropping it on the top half of A leaves it exactly there.
  await cards(page, "Todo")
    .getByRole("button", { name: /\bB\b/ })
    .dragTo(cards(page, "Todo").getByRole("button", { name: /\bA\b/ }), {
      targetPosition: { x: 40, y: 4 },
    })
  await expect(cards(page, "Todo")).toContainText(["C", "B", "A"])
  // A round trip after the drop: anything it had sent is counted by now.
  await page.evaluate(() => fetch("/api/health"))
  expect(patches).toBe(0)
})
