import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, workspaceIdBySlug } from "../support/projects"

/**
 * What the page observed about each overlay (dialog or menu) as it appeared:
 * - `animations`: running animations at the moment it was inserted
 * - `moves`: whether its transform differed from identity halfway through the animation
 * - `finished`: whether those animations ran to completion
 * Sampling happens in a MutationObserver callback, before the first paint, so it never races a
 * 150-200ms animation. The animations are paused at their midpoint to read the transform, then
 * restarted.
 */
type Observed = { animations: number; moves: boolean; finished: boolean }
type Probe = { opened: Observed[]; sawClosed: boolean }

async function observeOverlays(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const probe: Probe = { opened: [], sawClosed: false }
    ;(window as unknown as { __probe: Probe }).__probe = probe
    const seen = new WeakSet<Element>()
    new MutationObserver(() => {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (el.dataset.state === "closed") probe.sawClosed = true
        if (el.dataset.state !== "open" || seen.has(el)) continue
        seen.add(el)
        const animations = el.getAnimations()
        const entry: Observed = { animations: animations.length, moves: false, finished: false }
        probe.opened.push(entry)
        for (const a of animations) {
          a.pause()
          a.currentTime = Number(a.effect?.getComputedTiming().duration ?? 0) / 2
        }
        const t = getComputedStyle(el).transform
        entry.moves = t !== "none" && !new DOMMatrix(t).isIdentity
        for (const a of animations) {
          a.currentTime = 0
          a.play()
        }
        void Promise.all(animations.map((a) => a.finished)).then(() => {
          entry.finished = true
        })
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true })
  }, selector)
}

const probe = (page: Page) => page.evaluate(() => (window as unknown as { __probe: Probe }).__probe)

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

test("a dialog animates in and stays mounted while it animates out", async ({ page }) => {
  await boardWithTask(page)
  await observeOverlays(page, "[role=dialog]")

  await openProjectSettings(page)
  const dialog = page.getByRole("dialog", { name: "Project settings" })
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")

  await expect.poll(async () => (await probe(page)).sawClosed).toBe(true)
  await expect(dialog).toHaveCount(0)

  const [opened] = (await probe(page)).opened
  expect(opened?.animations).toBeGreaterThan(0)
  expect(opened?.moves).toBe(true)
  // The exit animation kept the element mounted (sawClosed) until it ended (count 0 above).
})

test("the task sheet slides in and out", async ({ page }) => {
  await boardWithTask(page)
  await observeOverlays(page, "[role=dialog]")

  await page.getByRole("button", { name: /Animate me/ }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet).toBeVisible()
  await page.keyboard.press("Escape")
  await expect.poll(async () => (await probe(page)).sawClosed).toBe(true)
  await expect(sheet).toHaveCount(0)

  const [opened] = (await probe(page)).opened
  expect(opened?.animations).toBeGreaterThan(0)
  expect(opened?.moves).toBe(true)
})

test("menus animate in", async ({ page }) => {
  await boardWithTask(page)
  await observeOverlays(page, "[role=menu]")

  await page.getByRole("button", { name: "Project options" }).click()
  await expect(page.getByRole("menu")).toBeVisible()

  // Menus scale from a popper-positioned wrapper, so only the presence of an animation is
  // asserted; whether its transform is non-identity at a given instant is not reliable.
  const [opened] = (await probe(page)).opened
  expect(opened?.animations).toBeGreaterThan(0)
})

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("dialogs and sheets still fade but never move", async ({ page }) => {
    await boardWithTask(page)
    await observeOverlays(page, "[role=dialog]")

    await page.getByRole("button", { name: /Animate me/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)

    await openProjectSettings(page)
    await expect(page.getByRole("dialog", { name: "Project settings" })).toBeVisible()

    const { opened } = await probe(page)
    expect(opened.length).toBe(2)
    for (const o of opened) {
      expect(o.animations).toBeGreaterThan(0)
      expect(o.moves).toBe(false)
    }
  })
})
