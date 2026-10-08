import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"
import { tokenValue } from "../support/styles"

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true })
const nav = (page: Page) => page.getByRole("navigation", { name: "Primary" })

async function openBoard(page: Page) {
  await signIn(page, { email: uniqueEmail(), name: "Ada Lovelace" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  const task = await createTaskViaApi(page, project.id, { title: "Write spec" })
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  const card = column(page, "Todo").getByRole("button", { name: /Write spec/ })
  await expect(card).toBeVisible()
  return { card, task }
}

test("c opens a composer with a borderless focused title and the full property row", async ({
  page,
}) => {
  const { card } = await openBoard(page)
  await card.focus()
  await page.keyboard.press("c")

  const dialog = page.getByRole("dialog", { name: "New task" })
  await expect(dialog).toBeVisible()
  const title = dialog.getByLabel("Title")
  await expect(title).toBeFocused()

  const ring = await title.evaluate((el) => {
    const s = getComputedStyle(el)
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow }
  })
  expect(ring.outlineStyle === "none" || ring.outlineWidth === "0px").toBe(true)
  expect(ring.boxShadow).toBe("none")

  await expect(dialog.locator(".cm-placeholder, textarea[placeholder]")).toHaveCount(1)
  await expect(
    dialog.getByText("Add a description.").or(dialog.getByPlaceholder("Add a description.")),
  ).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Change status" })).toContainText("Todo")
  await expect(dialog.getByRole("button", { name: "Change priority" })).toContainText("No priority")
  await expect(dialog.getByRole("button", { name: "Change assignees" })).toContainText("Ada")
  await expect(dialog.getByLabel("Due date", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Add tag" })).toBeVisible()

  await expect(dialog.getByLabel("Create more")).not.toBeChecked()
  await expect(dialog.getByText(/^(Ctrl ↵|⌘↵)$/)).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Create task" })).toBeVisible()
})

test("a card's context menu lists its actions in order and Escape closes it", async ({ page }) => {
  const { card } = await openBoard(page)
  await card.click({ button: "right" })

  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open",
    "Status",
    "Priority",
    "Assign to me",
    "Due date",
    "Copy link",
    "Copy ID",
    "Delete…",
  ])

  const colorOf = (name: string | RegExp) =>
    menu.getByRole("menuitem", { name }).evaluate((el) => getComputedStyle(el).color)
  expect(await colorOf(/^Delete/)).toBe(await tokenValue(page, "--destructive-foreground"))

  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
})

test("[ collapses and restores the sidebar while a card is focused", async ({ page }) => {
  const { card } = await openBoard(page)
  const sidebarWidth = () =>
    page.locator('nav[aria-label="Primary"]').evaluate((el) => {
      const aside = el.closest("aside") ?? el.parentElement ?? el
      return Math.round(aside.getBoundingClientRect().width)
    })

  await expect.poll(sidebarWidth).toBe(256)
  await card.focus()
  await page.keyboard.press("[")
  await expect(nav(page)).toBeHidden()
  await expect.poll(sidebarWidth).toBe(0)

  await card.focus()
  await page.keyboard.press("[")
  await expect(nav(page)).toBeVisible()
  await expect.poll(sidebarWidth).toBe(256)
})
