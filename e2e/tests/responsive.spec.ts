import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, workspaceIdBySlug } from "../support/projects"

const viewports = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
]

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const project = await createProject(page, await workspaceIdBySlug(page, slug), uniqueName("Proj"))
  const me = ((await (await page.request.get("/api/me")).json()) as { user: { id: string } }).user
  for (const title of ["A fairly long task title to force the row wide", "Another task"]) {
    const res = await page.request.post(`/api/projects/${project.id}/tasks`, {
      data: { title, priority: "high", dueAt: "2031-03-09" },
    })
    const { task } = (await res.json()) as { task: { id: string } }
    await page.request.patch(`/api/tasks/${task.id}`, { data: { assigneeIds: [me.id] } })
  }
  return { slug, projectId: project.id }
}

/**
 * Nothing may widen the page: the document, `main` and its content wrapper must fit, and no element
 * inside `main` may extend past the viewport unless an ancestor (a board or table scroller) scrolls.
 * Returns a description of the first offender, or null.
 */
const findOverflow = (page: Page) =>
  page.evaluate(() => {
    const fits = (el: Element) => el.scrollWidth <= el.clientWidth + 1
    const main = document.querySelector("main")
    if (!fits(document.documentElement)) return "document"
    if (!main) return "no main"
    if (!fits(main)) return "main"
    if (main.firstElementChild && !fits(main.firstElementChild)) return "main wrapper"
    const scrolls = (el: Element) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX)
    for (const el of main.querySelectorAll("*")) {
      if (el.getBoundingClientRect().right <= window.innerWidth + 1) continue
      let inScroller = false
      for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
        if (scrolls(p)) inScroller = true
      }
      if (!inScroller) return `<${el.tagName.toLowerCase()} class="${el.className}">`
    }
    return null
  })

for (const vp of viewports) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test("no page scrolls horizontally", async ({ page }) => {
      const { slug, projectId } = await setup(page)
      const paths = [
        `/w/${slug}/home`,
        `/w/${slug}/my-tasks`,
        `/w/${slug}/members`,
        `/w/${slug}/projects/${projectId}/board`,
        `/w/${slug}/projects/${projectId}/table`,
        "/settings",
      ]
      for (const path of paths) {
        await page.goto(path)
        await page.waitForLoadState("networkidle")
        expect(await findOverflow(page), path).toBeNull()
      }
    })

    test("the view switcher sits in the toolbar row and New task is reachable", async ({
      page,
    }) => {
      const { slug, projectId } = await setup(page)
      await page.goto(`/w/${slug}/projects/${projectId}/board`)
      const switcher = page.getByRole("group", { name: "View" })
      await expect(switcher).toBeVisible()
      const header = await page.getByRole("banner").boundingBox()
      const box = await switcher.boundingBox()
      expect(box && header && box.y >= header.y + header.height).toBe(true)

      await page.getByRole("button", { name: "New task" }).click()
      await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible()
    })

    test("the table scrolls inside its container", async ({ page }) => {
      const { slug, projectId } = await setup(page)
      await page.goto(`/w/${slug}/projects/${projectId}/table`)
      const scroller = page.getByRole("table", { name: "Tasks" }).locator("xpath=..")
      await expect(scroller).toBeVisible()
      const overflows = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)
      if (vp.width < 768) expect(overflows).toBe(true)
      expect(await findOverflow(page)).toBeNull()
    })
  })
}

test.describe("phone sheet", () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test("the task sheet covers the viewport and can be closed", async ({ page }) => {
    const { slug, projectId } = await setup(page)
    await page.goto(`/w/${slug}/projects/${projectId}/table`)
    await page.getByRole("button", { name: "Another task" }).click()
    const sheet = page.getByRole("dialog", { name: /-\d+$/ })
    await expect(sheet).toBeVisible()
    const box = await sheet.boundingBox()
    expect(box).toMatchObject({ x: 0, y: 0, width: 375, height: 812 })
    await sheet.getByRole("button", { name: "Close" }).click()
    await expect(sheet).toBeHidden()
  })
})

test.describe("touch targets", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test("small controls reach 44px on coarse pointers", async ({ page }) => {
    const { slug, projectId } = await setup(page)
    await page.goto(`/w/${slug}/projects/${projectId}/board`)
    // The hit area is an ::after box centred on the control.
    const hitArea = (locator: ReturnType<Page["locator"]>) =>
      locator.evaluate((el) => {
        const after = getComputedStyle(el, "::after")
        const own = el.getBoundingClientRect()
        return {
          width: Math.max(own.width, Number.parseFloat(after.width) || 0),
          height: Math.max(own.height, Number.parseFloat(after.height) || 0),
        }
      })
    const add = await hitArea(page.getByRole("button", { name: "Add task" }).first())
    expect(add.width).toBeGreaterThanOrEqual(44)
    expect(add.height).toBeGreaterThanOrEqual(44)

    await page.getByRole("button", { name: /Another task/ }).click()
    const close = await hitArea(
      page.getByRole("dialog", { name: /-\d+$/ }).getByRole("button", { name: "Close" }),
    )
    expect(close.width).toBeGreaterThanOrEqual(44)
    expect(close.height).toBeGreaterThanOrEqual(44)
  })
})

test("only one view switcher is focusable at a time", async ({ page }) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    if (width === 375) {
      const { slug, projectId } = await setup(page)
      await page.goto(`/w/${slug}/projects/${projectId}/board`)
    }
    // Hidden copies are display:none, so they never appear in the accessibility tree.
    await expect(page.getByRole("group", { name: "View" })).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Project options" })).toHaveCount(1)
  }
})

test("the members title stays on one line on a phone", async ({ page }) => {
  test.setTimeout(30_000)
  await page.setViewportSize({ width: 375, height: 812 })
  const { slug } = await setup(page)
  await page.goto(`/w/${slug}/members`)
  const heading = page.getByRole("heading", { name: "Members.", level: 1 })
  const { height, lineHeight } = await heading.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
  }))
  expect(height).toBeLessThan(lineHeight * 1.5)
  const actions = await page.getByRole("button", { name: "Add member" }).boundingBox()
  const title = await heading.boundingBox()
  expect(actions && title && actions.y >= title.y + title.height).toBe(true)
})
