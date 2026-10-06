import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, workspaceIdBySlug } from "../support/projects"

type Sample = { name: string; scale: string; translateX: string }
type Motion = { open: Sample[]; sawClosed: boolean }

/**
 * Records, for every dialog that appears, its animation while open (name plus the tw-animate-css
 * enter variables) and whether a `data-state="closed"` copy was ever in the DOM. Sampling from a
 * MutationObserver avoids racing a 150-200ms animation with Playwright's polling.
 */
async function recordDialogMotion(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __motion: Motion }
    w.__motion = { open: [], sawClosed: false }
    new MutationObserver(() => {
      for (const el of document.querySelectorAll<HTMLElement>("[role=dialog]")) {
        const style = getComputedStyle(el)
        if (el.dataset.state === "open") {
          w.__motion.open.push({
            name: style.animationName,
            scale: style.getPropertyValue("--tw-enter-scale").trim(),
            translateX: style.getPropertyValue("--tw-enter-translate-x").trim(),
          })
        }
        if (el.dataset.state === "closed") w.__motion.sawClosed = true
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true })
  })
}

const motion = (page: Page) =>
  page.evaluate(() => (window as unknown as { __motion: Motion }).__motion)

async function boardWithTask(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const project = await createProject(
    page,
    await workspaceIdBySlug(page, slug),
    uniqueName("Motion"),
  )
  const created = await page.request.post(`/api/projects/${project.id}/tasks`, {
    data: { title: "Animate me" },
  })
  expect(created.status()).toBe(201)
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  return { slug, project }
}

async function openProjectSettings(page: Page) {
  await page.getByRole("button", { name: "Project options" }).click()
  await page.getByRole("menuitem", { name: "Project settings" }).click()
}

test("a dialog zooms in and plays its exit animation before leaving the DOM", async ({ page }) => {
  await boardWithTask(page)
  await recordDialogMotion(page)

  await openProjectSettings(page)
  const dialog = page.getByRole("dialog", { name: "Project settings" })
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")

  await expect.poll(async () => (await motion(page)).sawClosed).toBe(true)
  await expect(dialog).toHaveCount(0)

  const { open } = await motion(page)
  expect(open.length).toBeGreaterThan(0)
  expect(open.every((s) => s.name === "enter")).toBe(true)
  // zoom-in-95 is applied: the start scale differs from the neutral value 1.
  expect(open.some((s) => s.scale !== "" && s.scale !== "1")).toBe(true)
})

test("the task sheet slides in from the right and out again", async ({ page }) => {
  await boardWithTask(page)
  await recordDialogMotion(page)

  await page.getByRole("button", { name: /Animate me/ }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet).toBeVisible()
  await page.keyboard.press("Escape")
  await expect.poll(async () => (await motion(page)).sawClosed).toBe(true)
  await expect(sheet).toHaveCount(0)

  const { open } = await motion(page)
  expect(open.some((s) => s.name === "enter" && s.translateX.includes("100%"))).toBe(true)
})

test("menus animate in", async ({ page }) => {
  await boardWithTask(page)
  await page.getByRole("button", { name: "Project options" }).click()
  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  expect(await menu.evaluate((el) => getComputedStyle(el).animationName)).toBe("enter")
})

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("dialogs and sheets only fade: no zoom, no slide", async ({ page }) => {
    await boardWithTask(page)
    await recordDialogMotion(page)

    await page.getByRole("button", { name: /Animate me/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)

    await openProjectSettings(page)
    await expect(page.getByRole("dialog", { name: "Project settings" })).toBeVisible()

    const { open } = await motion(page)
    expect(open.length).toBeGreaterThan(0)
    for (const s of open) {
      expect(s.name).toBe("enter")
      expect(["", "0"]).toContain(s.translateX)
      expect(["", "1"]).toContain(s.scale)
    }
  })
})
