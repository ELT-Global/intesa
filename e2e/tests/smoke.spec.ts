import { expect, test } from "@playwright/test"

test("API health endpoint responds", async ({ request }) => {
  const res = await request.get("/api/health")
  expect(res.ok()).toBe(true)
})

test("deep links fall back to the SPA", async ({ page }) => {
  const res = await page.goto("/some/deep/link")
  expect(res?.status()).toBe(200)
  // No route matches, but the app shell must still boot and render.
  await expect(page.locator("html.dark")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Page not found." })).toBeVisible()
})
