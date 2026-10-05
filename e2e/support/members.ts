import { type Browser, expect, type Page } from "@playwright/test"
import { signIn } from "./auth"

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
