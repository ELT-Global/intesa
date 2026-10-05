import { expect, test } from "@playwright/test"
import { signIn, uniqueEmail } from "../support/auth"
import { totp } from "../support/totp"

test("two-factor: enable, challenge on sign-in, disable", async ({ page }) => {
  const email = uniqueEmail("tfa")
  await signIn(page, { email })
  await page.goto("/settings")

  await page.getByRole("button", { name: "Set up two-factor" }).click()
  const secret = ((await page.getByLabel("Secret key").textContent()) ?? "").trim()
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/)
  await page.getByLabel("Verification code").fill(totp(secret))
  await page.getByRole("button", { name: "Enable two-factor" }).click()
  await expect(page.getByText("Two-factor authentication is on.")).toBeVisible()

  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)

  // Signing in again must stop at the second factor.
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/login\/2fa$/)

  await page.getByLabel("Authentication code").fill("000000")
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(page).toHaveURL(/\/login\/2fa$/)

  await page.getByLabel("Authentication code").fill(totp(secret))
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page).toHaveURL(/\/new-workspace$/)

  await page.goto("/settings")
  await page.getByLabel("Verification code").fill(totp(secret))
  await page.getByRole("button", { name: "Disable two-factor" }).click()
  await expect(page.getByRole("button", { name: "Set up two-factor" })).toBeVisible()
})
