import { type Browser, expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember, pageAs } from "../support/members"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

/** The Monday `weeksAgo` weeks before this week's, as YYYY-MM-DD in local time. */
function monday(weeksAgo = 0): string {
  const now = new Date()
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7) - 7 * weeksAgo,
  )
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function userId(page: Page): Promise<string> {
  const res = await page.request.get("/api/me")
  return ((await res.json()) as { user: { id: string } }).user.id
}

async function setStatus(page: Page, taskId: string, status: string) {
  const res = await page.request.patch(`/api/tasks/${taskId}`, { data: { status } })
  expect(res.ok()).toBe(true)
}

async function setup(page: Page, browser: Browser) {
  const otherEmail = uniqueEmail("grace")
  await signIn(page, { email: uniqueEmail("ada"), name: "Ada Lovelace" })
  const workspaceName = uniqueName("Engines")
  const slug = await createWorkspace(page, workspaceName)
  const workspaceId = await workspaceIdBySlug(page, slug)
  const other = await pageAs(browser, otherEmail, "Grace Hopper")
  const otherId = await userId(other)
  await other.context().close()
  await addMember(page, workspaceId, otherEmail)
  const myId = await userId(page)

  const project = await createProject(page, workspaceId, "Website")
  const done = await createTaskViaApi(page, project.id, {
    title: "Fix login redirect",
    assigneeIds: [myId],
  })
  await setStatus(page, done.id, "in_progress")
  await setStatus(page, done.id, "complete")
  const todo = await createTaskViaApi(page, project.id, {
    title: "Write release notes",
    assigneeIds: [myId],
  })
  const theirs = await createTaskViaApi(page, project.id, {
    title: "Add CSV export",
    status: "in_progress",
    assigneeIds: [otherId],
  })
  return { slug, workspaceName, project, done, todo, theirs }
}

const label = (page: Page) => page.getByRole("main").locator("p[aria-live]")

test("the sidebar opens the log, which lists each person's tasks by completion", async ({
  page,
  browser,
}) => {
  const { slug, done, todo, theirs } = await setup(page, browser)
  await page.goto(`/w/${slug}/home`)
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Weekly log" })
    .click()
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/log$`))
  await expect(page.getByRole("heading", { name: "Weekly log.", level: 1 })).toBeVisible()
  await expect(label(page)).toContainText("This week")

  const ada = page.getByRole("region", { name: "Ada Lovelace", exact: true })
  await expect(ada).toContainText("1 completed · 1 pending")
  const adaDone = ada.getByRole("list", { name: "Completed" }).getByRole("link")
  await expect(adaDone).toHaveCount(1)
  await expect(adaDone).toContainText(done.key)
  await expect(adaDone).toContainText("Fix login redirect")
  await expect(adaDone).toContainText("Completed")
  await expect(adaDone).toContainText("Todo → In progress")
  const adaPending = ada.getByRole("list", { name: "Pending" }).getByRole("link")
  await expect(adaPending).toHaveCount(1)
  await expect(adaPending).toContainText(todo.key)
  await expect(adaPending).toContainText("Todo")
  await expect(adaPending).toContainText("Assigned")

  const grace = page.getByRole("region", { name: "Grace Hopper", exact: true })
  await expect(grace.getByRole("list", { name: "Completed" })).toHaveCount(0)
  const gracePending = grace.getByRole("list", { name: "Pending" }).getByRole("link")
  await expect(gracePending).toContainText(theirs.key)
  await expect(gracePending).toContainText("In progress")

  const summary = page.getByRole("main").getByLabel("Summary")
  await expect(summary).toContainText("Completed1")
  await expect(summary).toContainText("Pending2")
})

test("Shift+arrows and the buttons move between weeks", async ({ page, browser }) => {
  const { slug } = await setup(page, browser)
  await page.goto(`/w/${slug}/log`)
  const next = page.getByRole("button", { name: "Next week" })
  await expect(page.getByRole("link", { name: /Fix login redirect/ })).toBeVisible()
  await expect(next).toBeDisabled()
  await expect(page.getByRole("button", { name: "This week", exact: true })).toHaveCount(0)

  await page.keyboard.press("Shift+ArrowLeft")
  await expect(page).toHaveURL(new RegExp(`/log\\?week=${monday(1)}$`))
  await expect(label(page)).toContainText("Last week")
  // Everything was made this week, so last week is empty.
  await expect(page.getByText("Nothing this week.")).toBeVisible()
  await expect(page.getByRole("link", { name: /Fix login redirect/ })).toHaveCount(0)
  await expect(next).toBeEnabled()

  await page.keyboard.press("Shift+ArrowRight")
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/log$`))
  await expect(label(page)).toContainText("This week")
  await expect(page.getByRole("link", { name: /Fix login redirect/ })).toBeVisible()

  // Past the current week is not reachable from the keyboard either.
  await page.keyboard.press("Shift+ArrowRight")
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/log$`))

  await page.getByRole("button", { name: "Previous week" }).click()
  await page.getByRole("button", { name: "Previous week" }).click()
  await expect(page).toHaveURL(new RegExp(`week=${monday(2)}$`))
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`week=${monday(1)}$`))

  await page.getByRole("button", { name: "This week", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/log$`))
  await expect(label(page)).toContainText("This week")
})

test("a week in the URL is kept across a reload, and a bad one falls back to this week", async ({
  page,
  browser,
}) => {
  const { slug } = await setup(page, browser)
  await page.goto(`/w/${slug}/log?week=${monday(1)}`)
  await expect(label(page)).toContainText("Last week")
  await page.reload()
  await expect(label(page)).toContainText("Last week")

  await page.goto(`/w/${slug}/log?week=not-a-week`)
  await expect(label(page)).toContainText("This week")
  await expect(page.getByRole("link", { name: /Fix login redirect/ })).toBeVisible()
})

test("clicking a row opens the task in its project", async ({ page, browser }) => {
  const { slug, project, todo } = await setup(page, browser)
  await page.goto(`/w/${slug}/log`)
  await page.getByRole("link", { name: /Write release notes/ }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}(/\\w+)?\\?.*task=${todo.id}`))
  await expect(page.getByRole("dialog", { name: todo.key })).toBeVisible()
})

test("Copy as Markdown copies the whole week with task links", async ({ page, browser }) => {
  const { slug, workspaceName, project, done, todo, theirs } = await setup(page, browser)
  await page.goto(`/w/${slug}/log`)
  const copy = page.getByRole("button", { name: "Copy as Markdown" })
  await expect(copy).toBeEnabled()
  await copy.click()
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible()

  // Windows clipboards hand text back with CRLF line endings.
  const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")
  const origin = new URL(page.url()).origin
  const link = (t: { id: string; key: string }) =>
    `[${t.key}](${origin}/w/${slug}/projects/${project.id}?task=${t.id})`
  expect(text).toMatch(/^# Weekly log · /)
  expect(text).toContain(`${workspaceName} · 1 completed · 2 pending`)
  expect(text).toContain("## Ada Lovelace\n\n1 completed · 1 pending\n\n**Completed**")
  expect(text).toContain(`- [x] ${link(done)} Fix login redirect — completed `)
  expect(text).toContain(`- [ ] ${link(todo)} Write release notes — Todo · assigned `)
  expect(text).toContain("## Grace Hopper\n\n1 pending\n\n**Pending**")
  expect(text).toContain(`- [ ] ${link(theirs)} Add CSV export — In progress · assigned `)

  await expect(page.getByRole("button", { name: "Copy as Markdown" })).toBeVisible()
})

test("members with nothing that week are listed together", async ({ page, browser }) => {
  const { slug } = await setup(page, browser)
  const idleEmail = uniqueEmail("mary")
  const idle = await pageAs(browser, idleEmail, "Mary Somerville")
  await idle.context().close()
  await addMember(page, await workspaceIdBySlug(page, slug), idleEmail)

  await page.goto(`/w/${slug}/log`)
  const nothing = page.getByRole("region", { name: "Nothing this week" })
  await expect(nothing).toContainText("Mary Somerville")
  await expect(nothing).not.toContainText("Ada Lovelace")
  await expect(page.getByRole("region", { name: "Mary Somerville" })).toHaveCount(0)
})
