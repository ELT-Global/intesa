import { expect, test } from "@playwright/test"
import { uniqueEmail } from "../support/auth"

test("unauthenticated visit to / redirects to /login", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("heading", { name: "Sign in to Intesa." })).toBeVisible()
})

test("dev sign-in lands a new user on workspace creation, sign out returns to login", async ({
  page,
}) => {
  await page.goto("/login")
  await page.getByLabel("Email").fill(uniqueEmail())
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/new-workspace$/)

  await page.goto("/settings")
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)

  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
})

test("login shows an error passed in the query string", async ({ page }) => {
  await page.goto("/login?error=access_denied")
  await expect(page.getByRole("alert")).toContainText(/denied/i)
})
