import { randomUUID } from "node:crypto"
import { expect, type Page } from "@playwright/test"

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`
}

export function uniqueName(prefix = "Team"): string {
  return `${prefix} ${randomUUID().slice(0, 6)}`
}

/**
 * The header a browser adds to the app's own requests. Cookie-authenticated API calls without
 * a JSON body need it, or the server refuses them as cross-site.
 */
export const sameOrigin = { headers: { "sec-fetch-site": "same-origin" } }

/** Signs in through the API; the session cookie lands in the page's context. */
export async function signIn(page: Page, { email, name }: { email: string; name?: string }) {
  const res = await page.request.post("/api/auth/dev-login", { data: { email, name } })
  expect(res.ok()).toBe(true)
}

/** Creates a workspace through the UI and waits for its home page. Returns the slug. */
export async function createWorkspace(page: Page, name: string): Promise<string> {
  await page.goto("/new-workspace")
  await page.getByLabel("Workspace name").fill(name)
  await page.getByRole("button", { name: "Create workspace" }).click()
  await page.waitForURL(/\/w\/[^/]+\/home$/)
  return new URL(page.url()).pathname.split("/")[2] as string
}
