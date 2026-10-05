import { type Browser, expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember, pageAs } from "../support/members"
import { createProject, workspaceIdBySlug } from "../support/projects"

async function userId(page: Page): Promise<string> {
  const res = await page.request.get("/api/me")
  return ((await res.json()) as { user: { id: string } }).user.id
}

async function setup(page: Page, browser: Browser) {
  const otherEmail = uniqueEmail("other")
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  await addMember(page, workspaceId, otherEmail)
  const other = await pageAs(browser, otherEmail)
  const otherId = await userId(other)
  await other.context().close()
  const myId = await userId(page)

  const alpha = await createProject(page, workspaceId, "Alpha Project")
  const beta = await createProject(page, workspaceId, "Beta Project")

  async function task(projectId: string, title: string, status: string, assignee: string | null) {
    const created = await page.request.post(`/api/projects/${projectId}/tasks`, {
      data: { title, status },
    })
    expect(created.status()).toBe(201)
    const { task } = (await created.json()) as { task: { id: string } }
    if (assignee) {
      const res = await page.request.patch(`/api/tasks/${task.id}`, {
        data: { assigneeIds: [assignee] },
      })
      expect(res.ok()).toBe(true)
    }
  }
  await task(alpha.id, "Mine in alpha", "todo", myId)
  await task(beta.id, "Mine in beta", "in_progress", myId)
  await task(beta.id, "Mine but done", "complete", myId)
  await task(alpha.id, "Theirs", "todo", otherId)
  await task(alpha.id, "Unassigned", "todo", null)
  return { slug, alphaId: alpha.id }
}

test("my tasks lists only tasks assigned to me, across projects", async ({ page, browser }) => {
  const { slug } = await setup(page, browser)
  await page.goto(`/w/${slug}/my-tasks`)
  await expect(page.getByRole("button", { name: /Mine in alpha/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Mine in beta/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Theirs/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Unassigned/ })).toHaveCount(0)
})

test("grouping by project shows a section per project and is kept in the URL", async ({
  page,
  browser,
}) => {
  const { slug } = await setup(page, browser)
  await page.goto(`/w/${slug}/my-tasks`)
  await expect(page.getByRole("region", { name: "Todo" })).toBeVisible()

  await page
    .getByRole("group", { name: "Group by" })
    .getByRole("button", { name: "Project" })
    .click()
  await expect(page).toHaveURL(/group=project/)
  await expect(
    page
      .getByRole("region", { name: "Alpha Project" })
      .getByRole("button", { name: /Mine in alpha/ }),
  ).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "Beta Project" })
      .getByRole("button", { name: /Mine in beta/ }),
  ).toBeVisible()

  await page.reload()
  await expect(page.getByRole("region", { name: "Alpha Project" })).toBeVisible()
})

test("completed tasks stay hidden until Show completed is on", async ({ page, browser }) => {
  const { slug } = await setup(page, browser)
  await page.goto(`/w/${slug}/my-tasks`)
  await expect(page.getByRole("button", { name: /Mine in alpha/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Mine but done/ })).toHaveCount(0)

  const toggle = page.getByRole("button", { name: "Show completed" })
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: /Mine but done/ })).toBeVisible()
})

test("clicking a task opens it in its project", async ({ page, browser }) => {
  const { slug, alphaId } = await setup(page, browser)
  await page.goto(`/w/${slug}/my-tasks`)
  await page.getByRole("button", { name: /Mine in alpha/ }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${alphaId}(/\\w+)?\\?.*task=`))
  await expect(page.getByRole("dialog", { name: /-1$/ })).toBeVisible()
})

test("shows an empty state when nothing is assigned", async ({ page }) => {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  await page.goto(`/w/${slug}/my-tasks`)
  await expect(page.getByText("Nothing assigned to you.")).toBeVisible()
})
