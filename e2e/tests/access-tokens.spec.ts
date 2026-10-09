import { expect, type Page, test } from "@playwright/test"
import { signIn, uniqueEmail, uniqueName } from "../support/auth"
import { approveDeviceRequest, startDeviceRequest } from "../support/device"

const tokenRow = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name })

async function createToken(
  page: Page,
  { name, scope, days }: { name: string; scope?: "Read only"; days?: number },
): Promise<string> {
  await page.getByLabel("Token name").fill(name)
  if (scope) await page.getByLabel("Scope").selectOption({ label: scope })
  if (days) await page.getByLabel("Expires in (days)").fill(String(days))
  await page.getByRole("button", { name: "Create token" }).click()
  const token = ((await page.getByLabel("New token").textContent()) ?? "").trim()
  expect(token).toMatch(/^intesa_pat_/)
  return token
}

async function revoke(page: Page, name: string) {
  await page.getByRole("button", { name: `Revoke ${name}` }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click()
  await expect(tokenRow(page, name)).toHaveCount(0)
}

test("a personal access token is shown once, listed, works, and stops working once revoked", async ({
  page,
  request,
}) => {
  await signIn(page, { email: uniqueEmail("pat") })
  await page.goto("/settings")
  await expect(page.getByRole("heading", { name: "Access tokens" })).toBeVisible()

  const name = uniqueName("CI bot")
  const token = await createToken(page, { name, days: 30 })
  await expect(page.getByText(/won't be shown again/i)).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy token" })).toBeVisible()

  const row = tokenRow(page, name)
  await expect(row).toContainText("Personal token")
  await expect(row).toContainText("Read and write")
  await expect(row).toContainText(token.slice(-4))
  await expect(row).toContainText("Never used")
  await expect(row).toContainText(/Expires/)

  const auth = { headers: { Authorization: `Bearer ${token}` } }
  expect((await request.get("/api/me", auth)).status()).toBe(200)

  // Dismissing the notice, or reloading, loses the plaintext for good.
  await page.getByRole("button", { name: "Done" }).click()
  await expect(page.getByLabel("New token")).toHaveCount(0)
  await page.reload()
  await expect(tokenRow(page, name)).toBeVisible()
  await expect(page.getByText(token)).toHaveCount(0)

  await revoke(page, name)
  expect((await request.get("/api/me", auth)).status()).toBe(401)
})

test("cancelling the revoke confirmation keeps the token", async ({ page }) => {
  await signIn(page, { email: uniqueEmail("keep") })
  await page.goto("/settings")
  const name = uniqueName("Keeper")
  await createToken(page, { name })

  await page.getByRole("button", { name: `Revoke ${name}` }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(tokenRow(page, name)).toBeVisible()
})

test("a read-only token can read but not change anything", async ({ page, request }) => {
  await signIn(page, { email: uniqueEmail("ro") })
  await page.goto("/settings")
  const name = uniqueName("Reader")
  const token = await createToken(page, { name, scope: "Read only" })
  await expect(tokenRow(page, name)).toContainText("Read only")

  const auth = { headers: { Authorization: `Bearer ${token}` } }
  expect((await request.get("/api/me", auth)).status()).toBe(200)
  const write = await request.patch("/api/me", { ...auth, data: { name: "Nope" } })
  expect(write.status()).toBe(403)
})

test("a CLI sign-in from a device approval is listed as a CLI session and can be revoked", async ({
  page,
  request,
}) => {
  await signIn(page, { email: uniqueEmail("cli") })
  const device = await startDeviceRequest(page)
  const token = await approveDeviceRequest(page, device)

  await page.goto("/settings")
  const row = tokenRow(page, device.clientName)
  await expect(row).toBeVisible()
  await expect(row).toContainText("CLI session")
  await expect(row).toContainText("Read and write")
  await expect(row).toContainText("Never used")
  await expect(row).toContainText(token.slice(-4))

  const auth = { headers: { Authorization: `Bearer ${token}` } }
  expect((await request.get("/api/me", auth)).status()).toBe(200)

  await revoke(page, device.clientName)
  expect((await request.get("/api/me", auth)).status()).toBe(401)
})
