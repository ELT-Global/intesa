import { expect, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, workspaceIdBySlug } from "../support/projects"

function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

test("home shows my open tasks and due-soon work, hides completed ones, and opens the task", async ({
  page,
}) => {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const project = await createProject(page, await workspaceIdBySlug(page, slug), uniqueName("Proj"))
  const me = ((await (await page.request.get("/api/me")).json()) as { user: { id: string } }).user

  async function assignedTask(title: string, status: string) {
    const created = await page.request.post(`/api/projects/${project.id}/tasks`, {
      data: { title, status, dueAt: tomorrow() },
    })
    expect(created.status()).toBe(201)
    const { task } = (await created.json()) as { task: { id: string } }
    const patched = await page.request.patch(`/api/tasks/${task.id}`, {
      data: { assigneeIds: [me.id] },
    })
    expect(patched.ok()).toBe(true)
  }
  await assignedTask("Open mine", "todo")
  await assignedTask("Finished mine", "complete")

  await page.goto(`/w/${slug}/home`)
  const assigned = page.getByRole("region", { name: "Assigned to you" })
  const due = page.getByRole("region", { name: "Due soon" })
  await expect(assigned.getByRole("link", { name: /Open mine/ })).toBeVisible()
  await expect(due.getByRole("link", { name: /Open mine/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /Finished mine/ })).toHaveCount(0)
  await expect(
    page.getByRole("region", { name: "Recent projects" }).getByRole("link", { name: /Proj/ }),
  ).toBeVisible()

  await assigned.getByRole("link", { name: /Open mine/ }).click()
  await expect(page).toHaveURL(/\/board\?task=/)
  await expect(page.getByRole("dialog", { name: `${project.key}-1` })).toBeVisible()
})

test("home shows calm empty states for a fresh workspace", async ({ page }) => {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  await page.goto(`/w/${slug}/home`)
  await expect(page.getByRole("region", { name: "Assigned to you" })).toContainText(/nothing/i)
  await expect(page.getByRole("region", { name: "Due soon" })).toContainText(/nothing/i)
})
