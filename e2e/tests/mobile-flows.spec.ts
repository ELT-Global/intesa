import { expect, type Locator, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { description } from "../support/editor"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

const VIEWPORT = { width: 375, height: 812 }

// Real touch input: taps, not mouse clicks, and a phone-sized viewport.
test.use({ viewport: VIEWPORT, hasTouch: true, isMobile: true })

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail(), name: "Ada Lovelace" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Proj"))
  return { slug, workspaceId, project }
}

/** Fails with the offending box when any part of the element sits outside the viewport. */
async function expectInsideViewport(locator: Locator, label: string) {
  const box = await locator.boundingBox()
  expect(box, `${label} has a box`).not.toBeNull()
  const { x, y, width, height } = box as NonNullable<typeof box>
  expect(x, `${label} left edge`).toBeGreaterThanOrEqual(0)
  expect(y, `${label} top edge`).toBeGreaterThanOrEqual(0)
  expect(x + width, `${label} right edge`).toBeLessThanOrEqual(VIEWPORT.width + 0.5)
  expect(y + height, `${label} bottom edge`).toBeLessThanOrEqual(VIEWPORT.height + 0.5)
}

test("sign in and create a first workspace using only taps", async ({ page }) => {
  await page.goto("/login")
  const email = page.getByLabel("Email")
  await expectInsideViewport(email, "email field")
  await email.fill(uniqueEmail())
  await page.getByRole("button", { name: "Sign in" }).tap()
  await page.waitForURL("**/new-workspace")

  const name = uniqueName("Phone")
  await page.getByLabel("Workspace name").fill(name)
  await expectInsideViewport(page.getByRole("button", { name: "Create workspace" }), "submit")
  await page.getByRole("button", { name: "Create workspace" }).tap()
  await page.waitForURL(/\/w\/[^/]+\/home$/)

  // The new workspace is the one the drawer reports as current.
  await page.getByRole("button", { name: "Open navigation" }).tap()
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Switch workspace" }),
  ).toContainText(name)
})

test("a drawer link navigates and closes the drawer", async ({ page }) => {
  const { slug, project } = await setup(page)
  await page.goto(`/w/${slug}/home`)

  await page.getByRole("button", { name: "Open navigation" }).tap()
  const drawer = page.getByRole("dialog")
  await drawer.getByRole("link", { name: "Members" }).tap()
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/members$`))
  await expect(drawer).toBeHidden()
  await expect(page.getByRole("heading", { name: "Members.", level: 1 })).toBeVisible()

  await page.getByRole("button", { name: "Open navigation" }).tap()
  await page.getByRole("dialog").getByRole("link", { name: project.key }).tap()
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}`))
  await expect(page.getByRole("dialog")).toBeHidden()
})

test("the workspace and account menus open inside the viewport", async ({ page }) => {
  const { slug } = await setup(page)
  await page.goto(`/w/${slug}/home`)
  await page.getByRole("button", { name: "Open navigation" }).tap()
  const drawer = page.getByRole("dialog")

  await drawer.getByRole("button", { name: "Switch workspace" }).tap()
  const switcher = page.getByRole("menu")
  await expect(
    switcher.getByRole("menuitem", { name: /New workspace|Create workspace/i }),
  ).toBeVisible()
  await expectInsideViewport(switcher, "workspace menu")
  await page.keyboard.press("Escape")
  await expect(switcher).toBeHidden()

  await drawer.getByRole("button", { name: "Account menu" }).tap()
  const account = page.getByRole("menu")
  await expect(account.getByRole("menuitem").first()).toBeVisible()
  await expectInsideViewport(account, "account menu")
})

test("every board column can be swiped to and snaps into the centre", async ({ page }) => {
  const { slug, project } = await setup(page)
  await createTaskViaApi(page, project.id, { title: "Ship it", status: "complete" })
  await page.goto(`/w/${slug}/projects/${project.id}/board`)

  const columns = page.getByTestId("board-canvas").getByRole("region")
  // One column per status: backlog, todo, in progress, review, complete. Wait for the loaded
  // columns (each has an "Add task" button): swiping over the loading skeletons would be flaky.
  await expect(columns).toHaveCount(5)
  await expect(columns.getByRole("button", { name: "Add task" })).toHaveCount(5)
  const count = 5

  const first = columns.first()
  const last = columns.last()
  // The last column starts off screen.
  const before = await last.boundingBox()
  expect((before as NonNullable<typeof before>).x).toBeGreaterThanOrEqual(VIEWPORT.width)

  // Swipe with real touch events, one column at a time; each swipe must land centred on the next.
  const client = await page.context().newCDPSession(page)
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x?: number) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: x === undefined ? [] : [{ x, y: 400 }],
    })
  const centreOffset = async (column: Locator) => {
    const box = (await column.boundingBox()) as NonNullable<
      Awaited<ReturnType<Locator["boundingBox"]>>
    >
    return Math.abs(box.x + box.width / 2 - VIEWPORT.width / 2)
  }
  for (let i = 1; i < count; i++) {
    await touch("touchStart", 300)
    for (let x = 300; x >= 100; x -= 20) {
      await touch("touchMove", x)
      await page.waitForTimeout(16)
    }
    // Let the last move be processed before lifting the finger, or a loaded machine drops the snap.
    await page.waitForTimeout(150)
    await touch("touchEnd")
    await expect
      .poll(() => centreOffset(columns.nth(i)), { message: `column ${i} centred` })
      .toBeLessThan(4)
  }

  await expect(last.getByRole("button", { name: /Ship it/ })).toBeVisible()
  const gone = await first.boundingBox()
  expect(
    (gone as NonNullable<typeof gone>).x + (gone as NonNullable<typeof gone>).width,
  ).toBeLessThanOrEqual(0)
})

test("the composer creates a task from a phone, with its popover on screen", async ({ page }) => {
  const { slug, project } = await setup(page)
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  await page.getByRole("button", { name: "New task" }).tap()

  const dialog = page.getByRole("dialog", { name: "New task" })
  await expectInsideViewport(dialog, "composer")
  await dialog.getByLabel("Title").fill("Tapped into existence")

  await dialog.getByRole("button", { name: "Change assignees" }).tap()
  const people = page.getByRole("dialog", { name: "Assignees" })
  await expectInsideViewport(people, "assignee popover")
  await page.getByRole("option", { name: "Assign to me" }).tap()
  await page.keyboard.press("Escape")
  await expect(people).toBeHidden()
  await expect(dialog.getByRole("button", { name: "Change assignees" })).toContainText("AL")

  await dialog.getByRole("button", { name: "Create task" }).tap()
  await expect(dialog).toBeHidden()

  await page.getByRole("region", { name: "Todo", exact: true }).scrollIntoViewIfNeeded()
  const card = page.getByRole("button", { name: /Tapped into existence/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText("AL")
})

test("a description written in the task sheet on a phone is still there after a reload", async ({
  page,
}) => {
  const { slug, project } = await setup(page)
  const task = await createTaskViaApi(page, project.id, { title: "Write it down" })
  await page.goto(`/w/${slug}/projects/${project.id}/table`)
  await page.getByRole("button", { name: /Write it down/ }).tap()

  const sheet = page.getByRole("dialog", { name: new RegExp(`${task.key}$`) })
  await description(sheet).tap()
  await page.keyboard.type("Remember the milk")
  // Leaving the field commits the edit.
  await sheet.getByRole("heading", { name: "Subtasks" }).tap()
  await sheet.getByRole("button", { name: "Close" }).tap()
  await expect(sheet).toBeHidden()

  await page.reload()
  await page.getByRole("button", { name: /Write it down/ }).tap()
  await expect(
    description(page.getByRole("dialog", { name: new RegExp(`${task.key}$`) })),
  ).toHaveText("Remember the milk")
})

test("task keys never wrap onto two lines in the phone table", async ({ page }) => {
  const { slug, project } = await setup(page)
  await createTaskViaApi(page, project.id, {
    title: "A title long enough to compete with its own key for the available width",
  })
  await page.goto(`/w/${slug}/projects/${project.id}/table`)

  const key = page
    .getByRole("table", { name: "Tasks" })
    .getByText(`${project.key}-1`, { exact: true })
  await expect(key).toBeVisible()
  const { height, lineHeight } = await key.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
  }))
  expect(height).toBeLessThan(lineHeight * 1.5)
})

test("a member can be added from the phone dialog", async ({ page }) => {
  const { slug } = await setup(page)
  await page.goto(`/w/${slug}/members`)
  await page.getByRole("button", { name: "Add member" }).tap()

  const dialog = page.getByRole("dialog", { name: "Add member" })
  await expectInsideViewport(dialog, "add member dialog")
  const email = uniqueEmail("teammate")
  await dialog.getByLabel("Email").fill(email)
  await dialog.getByRole("button", { name: "Add member" }).tap()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("table").getByText(email)).toBeVisible()
})

test("project options open a menu and a settings dialog that fit the phone", async ({ page }) => {
  const { slug, project } = await setup(page)
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  await page.getByRole("button", { name: "Project options" }).tap()

  const menu = page.getByRole("menu")
  await expectInsideViewport(menu, "options menu")
  await menu.getByRole("menuitem", { name: "Project settings" }).tap()
  const dialog = page.getByRole("dialog", { name: /settings/i })
  await expect(dialog).toBeVisible()
  await expectInsideViewport(dialog, "project settings dialog")
})
