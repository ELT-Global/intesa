import { expect, test } from "@playwright/test"
import { signIn, uniqueEmail } from "../support/auth"
import { pollDeviceToken, startDeviceRequest } from "../support/device"

test("approving a device request hands the terminal a working token", async ({ page, request }) => {
  const email = uniqueEmail("device")
  await signIn(page, { email })
  const device = await startDeviceRequest(page)

  await page.goto(`/device?code=${device.userCode}`)
  await expect(page.getByLabel("Device code")).toHaveValue(device.userCode)
  await page.getByRole("button", { name: "Continue" }).click()

  await expect(page.getByRole("heading", { name: `Approve ${device.clientName}?` })).toBeVisible()
  await expect(page.getByText(/Requested/)).toBeVisible()
  await page.getByRole("button", { name: "Approve" }).click()
  await expect(page.getByRole("heading", { name: "Device approved." })).toBeVisible()
  await expect(page.getByText(/return to your terminal/i)).toBeVisible()

  const poll = await pollDeviceToken(page, device.deviceCode)
  if (poll.status !== "approved") throw new Error(`Expected approved, got ${poll.status}`)
  expect(poll.token).toMatch(/^intesa_cli_/)
  expect(poll.user.email).toBe(email)

  // The bare `request` fixture carries no cookie, so only the bearer token can authenticate.
  const me = await request.get("/api/me", { headers: { Authorization: `Bearer ${poll.token}` } })
  expect(me.status()).toBe(200)
  expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email)
})

test("denying a device request tells the terminal and issues no token", async ({ page }) => {
  await signIn(page, { email: uniqueEmail("deny") })
  const device = await startDeviceRequest(page)

  await page.goto(`/device?code=${device.userCode}`)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("button", { name: "Deny" }).click()
  await expect(page.getByRole("heading", { name: "Request denied." })).toBeVisible()
  await expect(page.getByText(/return to your terminal/i)).toBeVisible()

  expect(await pollDeviceToken(page, device.deviceCode)).toEqual({ status: "denied" })
})

test("a code typed by hand is accepted in any case and without the dash", async ({ page }) => {
  await signIn(page, { email: uniqueEmail("typed") })
  const device = await startDeviceRequest(page)

  await page.goto("/device")
  await expect(page.getByLabel("Device code")).toHaveValue("")
  await page.getByLabel("Device code").fill(device.userCode.replace("-", "").toLowerCase())
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("heading", { name: `Approve ${device.clientName}?` })).toBeVisible()
})

test("an unknown code shows an error and no approve button", async ({ page }) => {
  await signIn(page, { email: uniqueEmail("unknown") })
  await page.goto("/device?code=BCDF-GHJK")
  await page.getByRole("button", { name: "Continue" }).click()

  await expect(page.getByRole("alert")).toContainText(/not found|expired/i)
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0)
  // The form stays so the code can be corrected.
  await expect(page.getByLabel("Device code")).toHaveValue("BCDF-GHJK")
})

test("too many wrong codes show a rate-limit message", async ({ page }) => {
  await signIn(page, { email: uniqueEmail("limited") })
  for (let i = 0; i < 5; i++) {
    const miss = await page.request.get("/api/auth/device/BCDF-GHJK")
    expect(miss.status()).toBe(404)
  }

  await page.goto("/device?code=BCDF-GHJK")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("alert")).toContainText(/too many attempts/i)
})

test("a signed-out visit goes through sign-in first", async ({ page }) => {
  await page.goto("/device?code=BCDF-GHJK")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("heading", { name: "Sign in to Intesa." })).toBeVisible()

  await page.getByLabel("Email").fill(uniqueEmail("late"))
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).not.toHaveURL(/\/login/)

  await page.goto("/device?code=BCDF-GHJK")
  await expect(page.getByLabel("Device code")).toHaveValue("BCDF-GHJK")
})
