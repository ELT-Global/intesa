import { expect, type Locator, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember, currentUserId, pageAs } from "../support/members"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)
const AVATAR_URL = /^\/api\/users\/[\w-]+\/avatar\?v=\w+$/

// Shown only once its bytes arrived and decoded.
const expectLoaded = async (img: Locator) => {
  await expect(img).toHaveAttribute("src", AVATAR_URL)
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
}

test("upload a profile picture, see it in the sidebar and for other members, then remove it", async ({
  page,
  browser,
}) => {
  await signIn(page, { email: uniqueEmail("ada"), name: "Ada Lovelace" })
  const slug = await createWorkspace(page, uniqueName())
  const graceEmail = uniqueEmail("grace")
  const grace = await pageAs(browser, graceEmail, "Grace Hopper")
  const workspaceId = await workspaceIdBySlug(page, slug)
  await addMember(page, workspaceId, graceEmail)

  await page.goto("/settings")
  const profile = page.locator("section", {
    has: page.getByRole("heading", { name: "Profile" }),
  })
  const avatar = profile.getByRole("img", { name: "Ada Lovelace" })
  const input = profile.locator('input[type="file"]')
  await expect(avatar).toHaveText("AL")
  await expect(profile.getByRole("button", { name: "Remove" })).toHaveCount(0)

  // SVG can carry script; images are judged by their bytes.
  await input.setInputFiles({
    name: "face.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  })
  await expect(profile.getByRole("alert")).toHaveText(
    "Avatars must be PNG, JPEG, GIF or WebP images.",
  )
  await expect(avatar.locator("img")).toHaveCount(0)

  await input.setInputFiles({ name: "face.png", mimeType: "image/png", buffer: PNG })
  await expectLoaded(avatar.locator("img"))
  await expect(profile.getByRole("alert")).toHaveCount(0)
  const src = (await avatar.locator("img").getAttribute("src")) ?? ""

  // The shell picks it up without a reload.
  await page.getByRole("link", { name: "Back" }).click()
  await page.waitForURL(/\/home$/)
  const account = page.getByRole("button", { name: "Account menu" }).locator("img")
  await expectLoaded(account)
  await expect(account).toHaveAttribute("src", src)

  // Other members see it too.
  await grace.goto(`/w/${slug}/members`)
  const adaRow = grace.getByRole("row", { name: /Ada Lovelace/ }).locator("img")
  await expectLoaded(adaRow)
  await expect(adaRow).toHaveAttribute("src", src)
  await grace.context().close()

  // Task cards and the assignee picker show it as well.
  const project = await createProject(page, workspaceId, "Avatars")
  const task = await createTaskViaApi(page, project.id, {
    title: "Paint the portrait",
    assigneeIds: [await currentUserId(page)],
  })
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  const onCard = page
    .getByRole("button", { name: /Paint the portrait/ })
    .getByRole("img", { name: "Ada Lovelace" })
    .locator("img")
  await expectLoaded(onCard)
  await expect(onCard).toHaveAttribute("src", src)
  await page.goto(`/w/${slug}/projects/${project.id}/board?task=${task.id}`)
  await page.getByRole("dialog").getByRole("button", { name: "Change assignees" }).click()
  const option = page.getByRole("option", { name: /Ada Lovelace/ }).locator("img")
  await expectLoaded(option)
  await expect(option).toHaveAttribute("src", src)
  await page.keyboard.press("Escape")

  await page.goto("/settings")
  await profile.getByRole("button", { name: "Remove" }).click()
  await expect(avatar.locator("img")).toHaveCount(0)
  await expect(avatar).toHaveText("AL")
  await expect(profile.getByRole("button", { name: "Remove" })).toHaveCount(0)
})
