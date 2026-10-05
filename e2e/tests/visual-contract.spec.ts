import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember } from "../support/members"
import { createProject, workspaceIdBySlug } from "../support/projects"
import { style, tokenValue } from "../support/styles"

function localDay(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Mirrors the app's due-date label: month and day, plus the year when it isn't the current one. */
function dayLabel(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })
}

const OVERDUE = -3
const SOON = 1
const FAR = 30

const SEED = [
  { title: "Overdue item", status: "backlog", dueAt: localDay(OVERDUE) },
  { title: "Soon item", status: "todo", priority: "high", dueAt: localDay(SOON) },
  { title: "Far item", status: "in_progress", priority: "medium", dueAt: localDay(FAR) },
  { title: "Urgent item", status: "review", priority: "urgent" },
  { title: "Done item", status: "complete", priority: "low", dueAt: localDay(OVERDUE) },
]

async function seededProject(page: Page) {
  await signIn(page, { email: uniqueEmail("vc"), name: "Vera Contract" })
  const slug = await createWorkspace(page, uniqueName("Contract"))
  const project = await createProject(page, await workspaceIdBySlug(page, slug), "Contract board")
  for (const data of SEED) {
    const res = await page.request.post(`/api/projects/${project.id}/tasks`, { data })
    expect(res.status()).toBe(201)
  }
  return { slug, project }
}

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true })
const card = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(title) })
const chip = (cardLocator: ReturnType<Page["locator"]>) =>
  cardLocator.locator("xpath=.//span[contains(@class,'inline-flex')]")

test("login: dark by default, native controls follow, sign-in is the primary button", async ({
  page,
}) => {
  await page.goto("/login")
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/)
  expect(await style(page.locator("html"), "color-scheme")).toBe("dark")
  await expect(page.getByLabel("Email")).toBeVisible()
  const signInButton = page.getByRole("button", { name: "Sign in" })
  expect(await style(signInButton, "background-color")).toBe(
    await tokenValue(page, "--primary", "backgroundColor"),
  )
  expect(await style(signInButton, "color")).toBe(await tokenValue(page, "--primary-foreground"))
})

test("switching to the light theme flips color-scheme", async ({ page }) => {
  await signIn(page, { email: uniqueEmail("theme") })
  await createWorkspace(page, uniqueName())
  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByRole("menuitem", { name: "Light theme" }).click()
  await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/)
  expect(await style(page.locator("html"), "color-scheme")).toBe("light")
})

test("a new workspace shows the full sidebar: wordmark, workspace card, nav, projects, profile", async ({
  page,
}) => {
  await signIn(page, { email: "dwight@example.test", name: "Dwight Schrute" })
  const slug = await createWorkspace(page, uniqueName("Dunder Mifflin"))
  expect(slug.startsWith("dunder-mifflin")).toBe(true)
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`))

  const sidebar = page.locator("aside")
  await expect(sidebar.getByText("Intesa", { exact: true })).toBeVisible()
  const workspaceCard = sidebar.getByRole("button", { name: "Switch workspace" })
  await expect(workspaceCard).toContainText("Dunder Mifflin")
  await expect(workspaceCard).toContainText("Owner")
  const nav = sidebar.getByRole("navigation", { name: "Primary" })
  await expect(nav.getByRole("link")).toHaveText(["Home", "My tasks", "Members"])
  await expect(sidebar.getByRole("region", { name: "Projects" })).toBeVisible()
  const profile = sidebar.getByRole("button", { name: "Account menu" })
  await expect(profile).toContainText("Dwight Schrute")
  await expect(profile).toContainText("dwight@example.test")
})

test("two-factor setup shows a QR code and secret; the code label is not monospace", async ({
  page,
}) => {
  await signIn(page, { email: uniqueEmail("qr") })
  await page.goto("/settings")
  await page.getByRole("button", { name: "Set up two-factor" }).click()

  await expect(
    page.getByRole("img", { name: "Authenticator QR code" }).locator("svg"),
  ).toBeVisible()
  await expect(page.getByLabel("Secret key")).toHaveText(/^[A-Z2-7]{16,}$/)

  const label = page.locator("label", { hasText: "Verification code" })
  const body = await style(page.locator("body"), "font-family")
  const labelFont = await style(label, "font-family")
  expect(labelFont).not.toMatch(/^\s*["']?Geist Mono/i)
  expect(labelFont).toBe(body)
  // The code itself is the one thing set in mono.
  expect(await style(page.getByLabel("Verification code"), "font-family")).toMatch(/mono/i)
})

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 860 },
]) {
  test(`board is full-bleed and fills the height at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const { slug, project } = await seededProject(page)
    await page.goto(`/w/${slug}/projects/${project.id}/board`)

    const statuses = ["Backlog", "Todo", "In progress", "Review", "Complete"]
    for (const name of statuses) await expect(column(page, name)).toBeVisible()

    const main = page.locator("main")
    const canvas = column(page, "Todo").locator(
      "xpath=ancestor::div[contains(@class,'overflow-x-auto')][1]",
    )
    const mainBox = await main.boundingBox()
    const canvasBox = await canvas.boundingBox()
    if (!mainBox || !canvasBox) throw new Error("board not laid out")
    const gutter =
      Number.parseFloat(await style(main, "padding-left")) +
      Number.parseFloat(await style(main, "padding-right"))
    expect(canvasBox.width).toBeGreaterThanOrEqual(mainBox.width - gutter - 2)
    expect(await style(main.locator("> div"), "max-width")).toBe("none")

    for (const name of statuses) {
      const box = await column(page, name).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThan(viewport.height * 0.6)
    }

    expect(await style(canvas, "overflow-x")).toBe("auto")
    expect(await canvas.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  })
}

test("card due chips: overdue is destructive, soon is warning, far is neutral, no-priority has no chip", async ({
  page,
}) => {
  const { slug, project } = await seededProject(page)
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  await expect(column(page, "Backlog")).toBeVisible()

  const destructive = await tokenValue(page, "--destructive-foreground")
  const warning = await tokenValue(page, "--warning-foreground")

  const overdue = card(page, "Overdue item").getByText("(overdue)").locator("..")
  await expect(overdue).toContainText(dayLabel(OVERDUE))
  expect(await style(overdue, "color")).toBe(destructive)
  const overdueBg = await style(overdue, "background-color")

  const soon = card(page, "Soon item").getByText("(due soon)").locator("..")
  await expect(soon).toContainText(dayLabel(SOON))
  expect(await style(soon, "color")).toBe(warning)

  const far = chip(card(page, "Far item")).filter({ hasText: dayLabel(FAR) })
  await expect(far).toHaveCount(1)
  expect(await style(far, "color")).not.toBe(destructive)
  expect(await style(far, "color")).not.toBe(warning)
  expect(await style(far, "background-color")).not.toBe(overdueBg)
  await expect(card(page, "Far item")).not.toContainText(/overdue|due soon/)

  // Completed work is never flagged, even with a past due date.
  const done = chip(card(page, "Done item")).filter({ hasText: dayLabel(OVERDUE) })
  expect(await style(done, "color")).not.toBe(destructive)
  await expect(card(page, "Done item")).not.toContainText("overdue")

  // Priority "none" renders no priority chip: the only chip is the due date.
  const noPriority = card(page, "Overdue item")
  await expect(chip(noPriority)).toHaveCount(1)
  await expect(noPriority).not.toContainText(/No priority|Low|Medium|High|Urgent/)
  await expect(card(page, "Urgent item")).toContainText("Urgent")
})

test("only the In progress status icon uses the info colour", async ({ page }) => {
  const { slug, project } = await seededProject(page)
  await page.goto(`/w/${slug}/projects/${project.id}/board`)

  const info = await tokenValue(page, "--info-foreground")
  const neutral = await tokenValue(page, "--muted-foreground")
  const signals = [
    info,
    await tokenValue(page, "--warning-foreground"),
    await tokenValue(page, "--success-foreground"),
    await tokenValue(page, "--destructive-foreground"),
  ]

  const iconColor = (name: string) =>
    style(column(page, name).locator("header svg").first(), "color")

  expect(await iconColor("In progress")).toBe(info)
  for (const name of ["Backlog", "Todo", "Review", "Complete"]) {
    const color = await iconColor(name)
    expect(color, `${name} icon`).toBe(neutral)
    expect(signals, `${name} icon`).not.toContain(color)
  }
})

test("opening a card shows the task sheet docked right with the full property strip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { slug, project } = await seededProject(page)
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
  await card(page, "Far item").click()

  const sheet = page.getByRole("dialog", { name: new RegExp(`^${project.key}-\\d+$`) })
  await expect(sheet).toBeVisible()
  const box = await sheet.boundingBox()
  if (!box) throw new Error("sheet not laid out")
  expect(box.x + box.width).toBeGreaterThanOrEqual(1280 - 1)
  expect(box.width).toBeLessThanOrEqual(640 + 1)
  expect(box.height).toBeGreaterThanOrEqual(800 - 1)

  await expect(sheet.locator("header").first()).toContainText(`${project.key}-`)
  await expect(sheet.locator("header").first()).toContainText("Contract board")

  await expect(sheet.getByRole("button", { name: "Change status" })).toContainText("In progress")
  await expect(sheet.getByRole("button", { name: "Change priority" })).toContainText("Medium")
  await expect(sheet.getByLabel("Due date", { exact: true })).toHaveValue(localDay(FAR))
  await expect(sheet.getByRole("button", { name: "Change assignees" })).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Add tag" })).toBeVisible()

  const title = sheet.getByRole("textbox", { name: "Task title" })
  await expect(title).toHaveValue("Far item")
  const titleSize = Number.parseFloat(await style(title, "font-size"))
  const descSize = Number.parseFloat(
    await style(sheet.getByRole("textbox", { name: "Description" }), "font-size"),
  )
  expect(titleSize).toBeGreaterThan(descSize * 1.5)
  await expect(sheet.getByRole("textbox", { name: "Description" })).toHaveAttribute(
    "placeholder",
    "Add a description.",
  )
  await expect(sheet.getByRole("button", { name: "History" })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
})

test("table view lists the seeded tasks with status, priority and due labels", async ({ page }) => {
  const { slug, project } = await seededProject(page)
  await page.goto(`/w/${slug}/projects/${project.id}/table`)
  const row = (title: string) =>
    page.getByRole("row").filter({ has: page.getByRole("button", { name: title }) })

  await expect(page.getByRole("row")).toHaveCount(SEED.length + 1)
  await expect(row("Overdue item")).toContainText("Backlog")
  await expect(row("Overdue item").getByRole("button", { name: "Change priority" })).toHaveText(
    "No priority",
  )
  await expect(row("Overdue item")).toContainText(dayLabel(OVERDUE))
  await expect(row("Soon item")).toContainText("Todo")
  await expect(row("Soon item")).toContainText("High")
  await expect(row("Far item")).toContainText("In progress")
  await expect(row("Far item")).toContainText(dayLabel(FAR))
  await expect(row("Urgent item")).toContainText("Review")
  await expect(row("Done item")).toContainText("Complete")
})

test("sheet structure: subtask progress ring and strike-through, blocker row, relationship and field controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { slug, project } = await seededProject(page)
  const post = async (path: string, data: object) => {
    const res = await page.request.post(path, { data })
    expect(res.ok(), path).toBe(true)
    return (await res.json()) as Record<string, { id: string; key: string }>
  }
  const parent = (await post(`/api/projects/${project.id}/tasks`, { title: "Parent work" })).task
  if (!parent) throw new Error("seed failed")
  const done = (
    await post(`/api/projects/${project.id}/tasks`, {
      title: "Finished part",
      parentTaskId: parent.id,
    })
  ).task
  await post(`/api/projects/${project.id}/tasks`, { title: "Open part", parentTaskId: parent.id })
  const blocker = (await post(`/api/projects/${project.id}/tasks`, { title: "Blocking work" })).task
  if (!done || !blocker) throw new Error("seed failed")
  const patched = await page.request.patch(`/api/tasks/${done.id}`, {
    data: { status: "complete" },
  })
  expect(patched.ok()).toBe(true)
  await post(`/api/tasks/${parent.id}/relationships`, { type: "blocked_by", taskId: blocker.id })
  await post(`/api/projects/${project.id}/custom-fields`, {
    name: "Stage",
    type: "select",
    options: ["Alpha", "Beta"],
  })
  await post(`/api/projects/${project.id}/custom-fields`, { name: "Notes", type: "text" })

  await page.goto(`/w/${slug}/projects/${project.id}/board?task=${parent.id}`)
  const sheet = page.getByRole("dialog", { name: parent.key })

  const subtasks = sheet.getByRole("region", { name: "Subtasks" })
  await expect(subtasks).toContainText("1/2")
  const ring = subtasks.locator("svg.-rotate-90")
  await expect(ring).toBeVisible()
  const [track, progress] = await ring.locator("circle").evaluateAll((els) =>
    els.map((el) => ({
      dash: Number.parseFloat(el.getAttribute("stroke-dasharray") ?? "0"),
      offset: Number.parseFloat(el.getAttribute("stroke-dashoffset") ?? "0"),
    })),
  )
  // Half of the circumference is hidden when one of two subtasks is complete.
  expect(progress?.dash).toBeGreaterThan(0)
  expect(progress?.offset).toBeCloseTo((progress?.dash ?? 0) / 2, 1)
  expect(track?.offset ?? 0).toBe(0)

  const lineThrough = (title: string) =>
    style(subtasks.getByRole("button", { name: title, exact: true }), "text-decoration-line")
  expect(await lineThrough("Finished part")).toContain("line-through")
  expect(await lineThrough("Open part")).toBe("none")

  const blockedBy = sheet.getByRole("group", { name: "Blocked by", exact: true })
  await expect(blockedBy).toContainText(blocker.key)
  await expect(blockedBy).toContainText("Blocking work")
  await expect(blockedBy.getByRole("button", { name: `Remove ${blocker.key}` })).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Add relationship" })).toBeVisible()

  const fields = sheet.getByRole("region", { name: "Fields" })
  const stage = fields.getByRole("combobox", { name: "Stage" })
  await expect(stage).toHaveValue("")
  expect(await stage.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent)).toBe(
    "None",
  )
  await expect(fields.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue("")
})

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test("board: compact top bar, toolbar row under the title, one snapping column at a time", async ({
    page,
  }) => {
    const { slug, project } = await seededProject(page)
    await page.goto(`/w/${slug}/projects/${project.id}/board`)
    await expect(column(page, "Backlog")).toBeVisible()

    const bar = page.getByRole("banner")
    await expect(bar.getByRole("button", { name: "Open navigation" })).toBeVisible()
    expect(
      await bar
        .getByRole("navigation", { name: "Breadcrumb" })
        .evaluate((el) => (el as HTMLElement).innerText.trim()),
    ).toBe("Contract board")
    await expect(bar.getByRole("group", { name: "View" })).toHaveCount(0)
    await expect(bar.getByRole("button", { name: "Project options" })).toHaveCount(0)
    const newTask = await bar.getByRole("button", { name: "New task" }).boundingBox()
    expect(newTask?.width ?? 999).toBeLessThanOrEqual(40)

    const title = await page
      .getByRole("heading", { name: "Contract board", level: 1 })
      .boundingBox()
    const switcher = await page.getByRole("group", { name: "View" }).boundingBox()
    const options = await page.getByRole("button", { name: "Project options" }).boundingBox()
    const barBox = await bar.boundingBox()
    if (!title || !switcher || !options || !barBox) throw new Error("toolbar not laid out")
    expect(switcher.y).toBeGreaterThanOrEqual(title.y + title.height - 1)
    expect(options.y).toBeGreaterThanOrEqual(barBox.y + barBox.height)
    const centreGap = Math.abs(options.y + options.height / 2 - (switcher.y + switcher.height / 2))
    expect(centreGap).toBeLessThan(switcher.height)

    const canvas = column(page, "Todo").locator(
      "xpath=ancestor::div[contains(@class,'overflow-x-auto')][1]",
    )
    expect(await style(canvas, "scroll-snap-type")).toMatch(/x\s+mandatory/)
    expect(await canvas.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await style(column(page, "Backlog"), "scroll-snap-align")).toContain("center")

    const boxes = await Promise.all(
      ["Backlog", "Todo", "In progress", "Review", "Complete"].map((n) =>
        column(page, n).boundingBox(),
      ),
    )
    for (const box of boxes) expect(box?.width).toBeCloseTo(375 * 0.85, 0)
    const fullyVisible = boxes.filter((b) => b && b.x >= 0 && b.x + b.width <= 375 + 1)
    expect(fullyVisible).toHaveLength(1)
  })

  test("members: the table scrolls inside its panel and the page does not", async ({ page }) => {
    await signIn(page, { email: uniqueEmail("pm"), name: "Phone Owner" })
    const slug = await createWorkspace(page, uniqueName("Phone"))
    const workspaceId = await workspaceIdBySlug(page, slug)
    await addMember(
      page,
      workspaceId,
      `a-very-long-colleague-address-for-overflow-${uniqueEmail("x")}`,
    )
    await page.goto(`/w/${slug}/members`)
    const table = page.getByRole("table", { name: "Workspace members" })
    await expect(table).toBeVisible()

    const scroller = table.locator("xpath=..")
    expect(await style(scroller, "overflow-x")).toBe("auto")
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    const panel = scroller.locator("xpath=..")
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true)
  })
})

test.describe("light theme", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("intesa-theme", "light"))
  })

  test("board and task sheet render on light surfaces; due chips keep their meaning", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const { slug, project } = await seededProject(page)
    await page.goto(`/w/${slug}/projects/${project.id}/board`)
    await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/)
    await expect(column(page, "Backlog")).toBeVisible()

    const background = await tokenValue(page, "--background", "backgroundColor")
    expect(await style(page.locator("body"), "background-color")).toBe(background)

    const overdueCard = card(page, "Overdue item")
    expect(await style(overdueCard, "background-color")).toBe(background)
    expect(await style(overdueCard, "border-top-color")).toBe(await tokenValue(page, "--border"))
    const columnFill = await style(column(page, "Backlog"), "background-color")
    expect(columnFill).not.toBe(background)
    expect(columnFill).not.toBe("rgba(0, 0, 0, 0)")

    const destructive = await tokenValue(page, "--destructive-foreground")
    const overdue = overdueCard.getByText("(overdue)").locator("..")
    expect(await style(overdue, "color")).toBe(destructive)
    const far = chip(card(page, "Far item")).filter({ hasText: dayLabel(FAR) })
    expect(await style(far, "color")).not.toBe(destructive)
    expect(await style(far, "color")).not.toBe(await tokenValue(page, "--warning-foreground"))

    await card(page, "Far item").click()
    const sheet = page.getByRole("dialog", { name: new RegExp(`^${project.key}-\\d+$`) })
    await expect(sheet).toBeVisible()
    const sheetBg = await style(sheet, "background-color")
    expect(sheetBg).toBe(background)
    expect(sheetBg).toBe(await tokenValue(page, "--popover", "backgroundColor"))
  })
})
