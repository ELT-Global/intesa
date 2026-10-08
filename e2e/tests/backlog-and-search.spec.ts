import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, PREFERENCES_KEY, workspaceIdBySlug } from "../support/projects"

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail("owner"), name: "Olive Owner" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"), {
    collapsedBacklog: true,
  })
  const make = async (input: Record<string, unknown>) => {
    const res = await page.request.post(`/api/projects/${project.id}/tasks`, { data: input })
    expect(res.status()).toBe(201)
  }
  await make({ title: "Sketch ideas", status: "backlog", priority: "low" })
  await make({ title: "Write spec", status: "todo", priority: "medium", body: "Cover the API" })
  await make({ title: "Ship release", status: "todo", priority: "medium" })
  await make({ title: "Fix login bug", status: "review", priority: "urgent" })
  return `/w/${slug}/projects/${project.id}`
}

const search = (page: Page) => page.getByRole("combobox", { name: "Search tasks" })
const card = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(title) })

test("the Backlog column is a rail until expanded, and the choice is remembered", async ({
  page,
}) => {
  const url = await setup(page)
  await page.goto(`${url}/board`)
  await expect(card(page, "Write spec")).toBeVisible()
  await expect(page.getByRole("region", { name: "Backlog" })).toHaveCount(0)
  const chip = page.getByRole("button", { name: "Show Backlog, 1 task" })
  await expect(chip).toBeVisible()

  await chip.click()
  await expect(page.getByRole("region", { name: "Backlog" })).toBeVisible()
  await expect(card(page, "Sketch ideas")).toBeVisible()

  await page.reload()
  await expect(card(page, "Sketch ideas")).toBeVisible()
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}").backlogExpanded,
    PREFERENCES_KEY,
  )
  expect(saved).toBe(true)

  await page.getByRole("button", { name: "Hide Backlog" }).click()
  await expect(page.getByRole("button", { name: "Show Backlog, 1 task" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: "Show Backlog, 1 task" })).toBeVisible()
})

test("board search filters by free text, description and field prefixes", async ({ page }) => {
  const url = await setup(page)
  await page.goto(`${url}/board`)
  await expect(card(page, "Write spec")).toBeVisible()

  await page.getByRole("button", { name: "Search tasks" }).click()
  await search(page).fill("login")
  await expect(card(page, "Fix login bug")).toBeVisible()
  await expect(card(page, "Write spec")).toHaveCount(0)

  // The description is searched too.
  await search(page).fill("api")
  await expect(card(page, "Write spec")).toBeVisible()
  await expect(card(page, "Ship release")).toHaveCount(0)

  await search(page).fill("priority:medium")
  await expect(card(page, "Write spec")).toBeVisible()
  await expect(card(page, "Ship release")).toBeVisible()
  await expect(card(page, "Fix login bug")).toHaveCount(0)

  await search(page).fill("priority:medium ship")
  await expect(card(page, "Ship release")).toBeVisible()
  await expect(card(page, "Write spec")).toHaveCount(0)

  await search(page).fill("-priority:medium")
  await expect(card(page, "Fix login bug")).toBeVisible()
  await expect(card(page, "Write spec")).toHaveCount(0)

  await search(page).fill("status:review,todo")
  await expect(card(page, "Fix login bug")).toBeVisible()
  await expect(card(page, "Write spec")).toBeVisible()

  // The Backlog chip counts what matches.
  await search(page).fill("priority:low")
  await expect(page.getByRole("button", { name: "Show Backlog, 1 task" })).toBeVisible()
  await search(page).fill("priority:high")
  await expect(page.getByRole("button", { name: "Show Backlog, 0 tasks" })).toBeVisible()
})

test("search suggests fields and values", async ({ page }) => {
  const url = await setup(page)
  await page.goto(`${url}/board`)
  await page.getByRole("button", { name: "Search tasks" }).click()

  await search(page).fill("pri")
  const list = page.getByRole("listbox", { name: "Search suggestions" })
  await expect(list.getByRole("option", { name: "priority:" })).toBeVisible()
  await list.getByRole("option", { name: "priority:" }).click()
  await expect(search(page)).toHaveValue("priority:")

  await expect(list.getByRole("option", { name: "urgent" })).toBeVisible()
  await search(page).press("ArrowDown")
  await search(page).press("ArrowDown")
  await search(page).press("Enter")
  await expect(search(page)).toHaveValue("priority:medium ")
  await expect(card(page, "Write spec")).toBeVisible()
  await expect(card(page, "Fix login bug")).toHaveCount(0)

  // Tab accepts the first suggestion.
  await search(page).fill("status:in")
  await search(page).press("Tab")
  await expect(search(page)).toHaveValue("status:in_progress ")

  // Escape closes the suggestions first, then clears and closes the field.
  await search(page).fill("sta")
  await expect(list).toBeVisible()
  await search(page).press("Escape")
  await expect(list).toBeHidden()
  await expect(search(page)).toHaveValue("sta")
  await search(page).press("Escape")
  await expect(search(page)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Search tasks" })).toBeVisible()
})

test("table search filters rows and says when nothing matches", async ({ page }) => {
  const url = await setup(page)
  await page.goto(`${url}/table`)
  const table = page.getByRole("table", { name: "Tasks" })
  await expect(table.getByText("Write spec")).toBeVisible()

  await page.getByRole("button", { name: "Search tasks" }).click()
  await search(page).fill("priority:urgent")
  await expect(table.getByText("Fix login bug")).toBeVisible()
  await expect(table.getByText("Write spec")).toHaveCount(0)

  await search(page).fill("nothing-like-this")
  await expect(page.getByText("No matching tasks.")).toBeVisible()
  await page.getByRole("button", { name: "Clear search" }).click()
  await expect(page.getByRole("button", { name: "Search tasks" })).toBeVisible()
  await expect(table.getByText("Write spec")).toBeVisible()
})
