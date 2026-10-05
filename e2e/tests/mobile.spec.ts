import { expect, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"

test.use({ viewport: { width: 375, height: 812 } })

test("sidebar becomes a drawer on small screens", async ({ page }) => {
  await signIn(page, { email: uniqueEmail() })
  await createWorkspace(page, uniqueName())

  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden()
  const trigger = page.getByRole("button", { name: "Open navigation" })
  await trigger.click()

  const drawer = page.getByRole("dialog")
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole("link", { name: "My tasks" })).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
})
