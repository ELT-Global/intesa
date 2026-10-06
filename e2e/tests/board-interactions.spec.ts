import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true })

async function setup(page: Page, titles: string[], view: "board" | "table" = "board") {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  const tasks = []
  for (const title of titles) tasks.push(await createTaskViaApi(page, project.id, { title }))
  await page.goto(`/w/${slug}/projects/${project.id}/${view}`)
  return { slug, project, tasks }
}

// Playwright cannot drive native drag and drop to a stationary pointer near an edge, so these
// tests dispatch the dragover events a browser sends while the pointer is held there.
async function holdDragOver(
  target: ReturnType<Page["locator"]>,
  edge: "left" | "right" | "bottom",
  ms = 600,
) {
  await target.evaluate(
    async (el, { edge, ms }) => {
      const box = el.getBoundingClientRect()
      const x = edge === "right" ? box.right - 8 : edge === "left" ? box.left + 8 : box.left + 40
      const y = edge === "bottom" ? box.bottom - 8 : box.top + 120
      const data = new DataTransfer()
      data.setData("text/plain", "task")
      const end = performance.now() + ms
      while (performance.now() < end) {
        el.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: data,
          }),
        )
        await new Promise((r) => setTimeout(r, 30))
      }
    },
    { edge, ms },
  )
}

test("dragging near the board's edges scrolls it sideways", async ({ page }) => {
  await setup(page, ["Write spec"])
  const canvas = page.getByTestId("board-canvas")
  expect(await canvas.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  expect(await canvas.evaluate((el) => el.scrollLeft)).toBe(0)

  await holdDragOver(canvas, "right")
  const scrolled = await canvas.evaluate((el) => el.scrollLeft)
  expect(scrolled).toBeGreaterThan(0)

  await holdDragOver(canvas, "left")
  expect(await canvas.evaluate((el) => el.scrollLeft)).toBeLessThan(scrolled)
})

test("dragging near the bottom of a long column scrolls that column", async ({ page }) => {
  await setup(
    page,
    Array.from({ length: 16 }, (_, i) => `Task number ${i + 1}`),
  )
  const body = column(page, "Todo").locator("[data-column-body]")
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

  await holdDragOver(body, "bottom")
  expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
})

test("right-clicking a card changes its status from the menu", async ({ page }) => {
  await setup(page, ["Write spec"])
  await column(page, "Todo")
    .getByRole("button", { name: /Write spec/ })
    .click({ button: "right" })
  await page.getByRole("menuitem", { name: "Status" }).click()
  await page.getByRole("menuitemradio", { name: "In progress" }).click()
  await expect(
    column(page, "In progress").getByRole("button", { name: /Write spec/ }),
  ).toBeVisible()
})

test("the menu opens from the keyboard and copies the task id", async ({ page }) => {
  const { tasks } = await setup(page, ["Write spec"])
  const card = column(page, "Todo").getByRole("button", { name: /Write spec/ })
  await card.focus()
  await page.keyboard.press("Shift+F10")
  await expect(page.getByRole("menu")).toBeVisible()
  await page.getByRole("menuitem", { name: "Copy ID" }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(tasks[0]?.key)
})

test("a table row's menu deletes the task after confirming", async ({ page }) => {
  await setup(page, ["Write spec", "Keep me"], "table")
  await page.getByRole("row", { name: /Write spec/ }).click({ button: "right" })
  await page.getByRole("menuitem", { name: /^Delete/ }).click()
  const confirm = page.getByRole("dialog", { name: "Delete task?" })
  await confirm.getByRole("button", { name: "Delete" }).click()

  await expect(page.getByRole("row", { name: /Write spec/ })).toHaveCount(0)
  await expect(page.getByRole("row", { name: /Keep me/ })).toBeVisible()
})
