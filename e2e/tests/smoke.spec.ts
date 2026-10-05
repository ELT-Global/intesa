import { expect, test } from "@playwright/test"

test("home page reaches the API", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("health")).toHaveText("API OK")
})

test("deep links fall back to the SPA", async ({ page }) => {
  const res = await page.goto("/some/deep/link")
  expect(res?.status()).toBe(200)
  // No route matches, but the app shell must still boot and render.
  await expect(page.locator("html.dark")).toBeVisible()
  await expect(page.locator("body")).not.toBeEmpty()
})
