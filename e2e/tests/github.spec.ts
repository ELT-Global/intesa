import { createHmac } from "node:crypto"
import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"
import { column, moveDialog } from "../support/status-change"

// Wide enough for all five columns, so a drag onto the last one lands.
test.use({ viewport: { width: 1800, height: 900 } })

const REPO = "acme/web"

const card = (page: Page, col: string, title: string) =>
  column(page, col).getByRole("button", { name: new RegExp(title) })

/** Sends a pull_request event the way GitHub does: JSON, signed with the webhook's secret. */
async function deliverPullRequest(page: Page, url: string, secret: string, title: string) {
  const body = JSON.stringify({
    action: "opened",
    repository: { full_name: REPO },
    pull_request: {
      number: 12,
      title,
      body: null,
      state: "open",
      draft: false,
      merged_at: null,
      html_url: `https://github.com/${REPO}/pull/12`,
      updated_at: new Date().toISOString(),
      user: { login: "ada" },
      base: { ref: "qa" },
    },
  })
  const res = await page.request.post(new URL(url).pathname, {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
  })
  expect(res.ok()).toBe(true)
  return res.json()
}

test("an owner creates the webhook; a PR saying 'Fixes KEY' starts the task with an In PR capsule", async ({
  page,
}) => {
  await signIn(page, { email: uniqueEmail("github"), name: "Ada Owner" })
  const slug = await createWorkspace(page, uniqueName("GitHub"))
  const workspaceId = await workspaceIdBySlug(page, slug)

  await page.goto(`/w/${slug}/settings`)
  await page.getByRole("button", { name: "Create webhook" }).click()
  const secret = (await page.getByLabel("Secret", { exact: true }).textContent()) ?? ""
  const url = (await page.getByLabel("Payload URL").textContent()) ?? ""
  expect(secret).toMatch(/^[0-9a-f]{48}$/)
  expect(url).toContain("/api/webhooks/github/")
  await expect(page.getByLabel("Merge branch")).toHaveValue("qa")

  const project = await createProject(page, workspaceId, "Project")
  const task = await createTaskViaApi(page, project.id, { title: "Wire the webhook" })
  await createTaskViaApi(page, project.id, { title: "Started by hand" })
  const reply = await deliverPullRequest(page, url, secret, `Fixes ${task.key}`)
  expect(reply.moved).toEqual([{ task: task.key, to: "in_progress" }])

  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  await expect(card(page, "In progress", "Wire the webhook")).toContainText("In PR")

  // Starting a task by hand offers to link its PR; leaving the field empty still moves it.
  await card(page, "Todo", "Started by hand").dragTo(column(page, "In progress"))
  const dialog = moveDialog(page)
  const field = dialog.getByLabel("Pull request (optional)")
  // A PR that cannot be linked is reported in the dialog, which keeps what was typed.
  await field.fill("not a pr")
  await dialog.getByRole("button", { name: "Move", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("owner/repo#482")
  await expect(field).toHaveValue("not a pr")
  await field.fill("")
  await dialog.getByRole("button", { name: "Move", exact: true }).click()
  const moved = card(page, "In progress", "Started by hand")
  await expect(moved).toBeVisible()
  await expect(moved).not.toContainText("In PR")

  // The task sheet lists the linked PR.
  await page.goto(`/w/${slug}/projects/${project.id}/board?task=${task.id}`)
  const section = page.getByRole("region", { name: "Pull requests" })
  await expect(section.getByRole("link", { name: /#12/ })).toHaveAttribute(
    "href",
    `https://github.com/${REPO}/pull/12`,
  )
})
