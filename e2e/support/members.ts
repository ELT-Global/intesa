import { type Browser, expect, type Page } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "./auth"
import { workspaceIdBySlug } from "./projects"

/** Adds a member by email through the API as the page's signed-in user. */
export async function addMember(
  page: Page,
  workspaceId: string,
  email: string,
  role: "owner" | "member" = "member",
) {
  const res = await page.request.post(`/api/workspaces/${workspaceId}/members`, {
    data: { email, role },
  })
  expect(res.status()).toBe(201)
}

/** Opens a separate browser context signed in as `email` (its own cookie jar). */
export async function pageAs(browser: Browser, email: string, name?: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, { email, name })
  return page
}

/** The id of the user the page is signed in as. */
export async function currentUserId(page: Page): Promise<string> {
  const res = await page.request.get("/api/me")
  return ((await res.json()) as { user: { id: string } }).user.id
}

/**
 * Signs `page` in as Ada Lovelace, who owns a new workspace that Grace Hopper (a second, separate
 * session) belongs to as well. Returns both ids with the workspace's slug and id.
 */
export async function workspaceWithMember(page: Page, browser: Browser) {
  const graceEmail = uniqueEmail("grace")
  await signIn(page, { email: uniqueEmail("ada"), name: "Ada Lovelace" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const grace = await pageAs(browser, graceEmail, "Grace Hopper")
  const graceId = await currentUserId(grace)
  await grace.context().close()
  await addMember(page, workspaceId, graceEmail)
  return { slug, workspaceId, adaId: await currentUserId(page), graceId }
}
