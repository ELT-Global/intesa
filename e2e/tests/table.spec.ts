import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, workspaceIdBySlug } from "../support/projects"

type Seed = { title: string; status?: string; priority?: string; dueAt?: string }

async function setup(page: Page, tasks: Seed[]) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const project = await createProject(page, await workspaceIdBySlug(page, slug), uniqueName("Proj"))
  for (const data of tasks) {
    const res = await page.request.post(`/api/projects/${project.id}/tasks`, { data })
    expect(res.status()).toBe(201)
  }
  await page.goto(`/w/${slug}/projects/${project.id}/table`)
  return { slug, projectId: project.id }
}

const row = (page: Page, title: string) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name: title }) })

test("the table lists every task with its status, priority and due date", async ({ page }) => {
  await setup(page, [
    { title: "Plan launch", status: "in_progress", priority: "high", dueAt: "2031-03-09" },
    { title: "Write docs" },
  ])
  const plan = row(page, "Plan launch")
  await expect(plan).toContainText("In progress")
  await expect(plan).toContainText("High")
  await expect(plan).toContainText("Mar 9, 2031")
  const docs = row(page, "Write docs")
  await expect(docs).toContainText("Todo")
  await expect(docs.getByRole("button", { name: "Change priority" })).toContainText("No priority")
  await expect(page.getByRole("row")).toHaveCount(3) // header + 2
})

test("on a wide screen the table spans the main area, like the board", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 })
  await setup(page, [{ title: "A title long enough to want the room ".repeat(4).trim() }])
  const main = await page.locator("#main").boundingBox()
  const table = await page.getByRole("table", { name: "Tasks" }).boundingBox()
  // Narrower pages are capped at 56rem (896px); the table takes nearly all of main instead.
  expect(table?.width ?? 0).toBeGreaterThan((main?.width ?? 0) - 120)
  expect(table?.width ?? 0).toBeGreaterThan(1200)
})

test("sorting by priority orders urgent to low and puts unset last", async ({ page }) => {
  await setup(page, [
    { title: "Low one", priority: "low" },
    { title: "No priority one" },
    { title: "Urgent one", priority: "urgent" },
    { title: "High one", priority: "high" },
  ])
  await page.getByRole("button", { name: "Priority", exact: true }).click()
  await expect(page.getByRole("columnheader", { name: "Priority" })).toHaveAttribute(
    "aria-sort",
    "ascending",
  )
  const titles = page.getByRole("row").getByRole("button", { name: /one$/ })
  await expect(titles).toHaveText([/Urgent one/, /High one/, /Low one/, /No priority one/])
})

test("clicking a row opens the task sheet", async ({ page }) => {
  await setup(page, [{ title: "Open me" }])
  await row(page, "Open me").getByRole("button", { name: "Open me" }).click()
  await expect(page.getByRole("dialog", { name: /-1$/ })).toBeVisible()
  await expect(page).toHaveURL(/task=/)
})

test("changing status in the table shows in the board column without a reload", async ({
  page,
}) => {
  const { slug, projectId } = await setup(page, [{ title: "Move me" }])
  await row(page, "Move me").getByRole("button", { name: "Change status" }).click()
  await page.getByRole("menuitemradio", { name: "Review" }).click()
  await expect(row(page, "Move me")).toContainText("Review")

  await page.getByRole("button", { name: "Board" }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/projects/${projectId}/board`))
  await expect(
    page
      .getByRole("region", { name: "Review", exact: true })
      .getByRole("button", { name: /Move me/ }),
  ).toBeVisible()
})
