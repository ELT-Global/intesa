import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { description, editorHost } from "../support/editor"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

async function openBoard(page: Page) {
  await signIn(page, { email: uniqueEmail(), name: "Ada Lovelace" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  const url = `/w/${slug}/projects/${project.id}/board`
  await page.goto(url)
  return { url, project }
}

async function openComposer(page: Page) {
  await page.getByRole("button", { name: "New task" }).click()
  const dialog = page.getByRole("dialog", { name: "New task" })
  await expect(dialog).toBeVisible()
  return dialog
}

const editorChunk = /editor-view.*\.js/
const isCreate = (r: { method(): string; url(): string }) =>
  r.method() === "POST" && /\/api\/projects\/[^/]+\/tasks$/.test(r.url())

test.describe("composer description", () => {
  test("renders live preview and keeps raw markdown when the task is created", async ({ page }) => {
    const { project } = await openBoard(page)
    const dialog = await openComposer(page)
    await dialog.getByLabel("Title").fill("Rich description")
    await expect(editorHost(dialog)).toHaveAttribute("data-editor", "ready")

    const editor = description(dialog)
    await editor.click()
    await page.keyboard.type("# Heading")
    await page.keyboard.press("Enter")
    await page.keyboard.type("plain **bold** text")

    // With the caret on another line the markers disappear and the styles apply.
    await expect(editor.locator(".cm-lp-h1")).toHaveText("Heading")
    await expect(editor.locator(".cm-lp-strong")).toHaveText("bold")
    await expect(editor).not.toContainText("**")
    await expect(editor).not.toContainText("# ")

    // Moving onto the heading reveals its marker again.
    await editor.locator(".cm-lp-h1").click()
    await expect(editor).toContainText("# Heading")

    const created = page.waitForRequest(isCreate)
    await page.keyboard.press("ControlOrMeta+Enter")
    expect((await created).postDataJSON().body).toBe("# Heading\nplain **bold** text")
    await expect(dialog).toBeHidden()

    await page.getByRole("button", { name: /Rich description/ }).click()
    const sheet = page.getByRole("dialog", { name: `${project.key}-1` })
    await expect(description(sheet).locator(".cm-lp-h1:not(.cm-lp-syntax)")).toHaveText("Heading")
  })

  test("Ctrl+Enter submits without adding a line, Enter adds one", async ({ page }) => {
    await openBoard(page)
    const dialog = await openComposer(page)
    await dialog.getByLabel("Title").fill("Enter semantics")
    await expect(editorHost(dialog)).toHaveAttribute("data-editor", "ready")
    await description(dialog).click()
    await page.keyboard.type("one")
    await page.keyboard.press("Enter")
    await page.keyboard.type("two")

    const created = page.waitForRequest(isCreate)
    await page.keyboard.press("ControlOrMeta+Enter")
    expect((await created).postDataJSON().body).toBe("one\ntwo")
  })

  test("formatting shortcuts, lists, task checkboxes and input rules", async ({ page }) => {
    await openBoard(page)
    const dialog = await openComposer(page)
    await expect(editorHost(dialog)).toHaveAttribute("data-editor", "ready")
    const editor = description(dialog)
    await editor.click()

    await page.keyboard.type("word")
    await page.keyboard.press("Shift+Home")
    await page.keyboard.press("ControlOrMeta+b")
    await expect(editor).toContainText("**word**")
    await page.keyboard.press("End")

    await page.keyboard.press("Enter")
    await page.keyboard.type("- [ ] ship it")
    await page.keyboard.press("Enter")
    // Enter on a task line continues the list.
    await page.keyboard.type("second")
    // The caret line stays raw; the finished line shows a checkbox.
    const checkbox = editor.locator("input.cm-lp-checkbox")
    await expect(checkbox).toHaveCount(1)
    await expect(checkbox).not.toBeChecked()
    await checkbox.click()
    await expect(checkbox).toBeChecked()

    await page.keyboard.press("Enter")
    await page.keyboard.press("Enter")
    await page.keyboard.type("--")
    await expect(editor).toContainText("—")
    await page.keyboard.press("Backspace")
    await expect(editor).toContainText("--")
  })

  test("undo and redo work", async ({ page }) => {
    await openBoard(page)
    const dialog = await openComposer(page)
    await expect(editorHost(dialog)).toHaveAttribute("data-editor", "ready")
    const editor = description(dialog)
    await editor.click()
    await page.keyboard.type("first")
    await page.waitForTimeout(600) // history groups quick typing into one step
    await page.keyboard.type(" second")
    await page.keyboard.press("ControlOrMeta+z")
    await expect(editor).toHaveText("first")
    await page.keyboard.press("ControlOrMeta+Shift+Z")
    await expect(editor).toHaveText("first second")
    await page.keyboard.press("ControlOrMeta+z")
    await expect(editor).toHaveText("first")
    await page.keyboard.press("ControlOrMeta+y")
    await expect(editor).toHaveText("first second")
  })

  test("a paste past 20,000 characters is rejected", async ({ page }) => {
    await openBoard(page)
    const dialog = await openComposer(page)
    await expect(editorHost(dialog)).toHaveAttribute("data-editor", "ready")
    const editor = description(dialog)
    await editor.click()
    await editor.evaluate((el) => {
      const data = new DataTransfer()
      data.setData("text/plain", "a".repeat(20_001))
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }))
    })
    await expect(editor.locator(".cm-placeholder")).toBeVisible()
  })
})

test.describe("speed", () => {
  test("typing works at once even while the editor chunk is still downloading", async ({
    page,
  }) => {
    // Hold the chunk back so the instant textarea is what the user meets.
    await page.route(editorChunk, async (route) => {
      await new Promise((r) => setTimeout(r, 2500))
      await route.continue()
    })
    await openBoard(page)
    const dialog = await openComposer(page)
    await expect(editorHost(dialog)).toHaveAttribute("data-editor", "loading")

    const field = description(dialog)
    await field.click()
    await expect(field).toBeFocused()
    await page.keyboard.type("typed before the editor loaded")
    await page.keyboard.press("Home")
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")

    // The swap keeps the text, the focus and the caret.
    await expect(editorHost(dialog)).toHaveAttribute("data-editor", "ready", { timeout: 10_000 })
    await expect(field).toBeFocused()
    await expect(field).toHaveText("typed before the editor loaded")
    await page.keyboard.type("|")
    await expect(field).toHaveText("ty|ped before the editor loaded")
  })

  test("once the browser has been idle the editor is there on first paint", async ({ page }) => {
    const chunk = page.waitForResponse(editorChunk)
    await openBoard(page)
    await chunk

    const dialog = await openComposer(page)
    // No textarea stage at all: the editor is mounted as the dialog appears.
    await expect(editorHost(dialog)).toHaveAttribute("data-editor", "ready")
    await expect(dialog.locator("textarea.cm-plain")).toHaveCount(0)

    // Interactive at once: the first keystrokes land in the document.
    await description(dialog).click()
    await page.keyboard.type("instant")
    await expect(description(dialog)).toHaveText("instant")
  })

  test("the editor chunk is not part of the initial page load", async ({ page }) => {
    const loaded: string[] = []
    page.on("response", (r) => {
      if (r.url().endsWith(".js")) loaded.push(r.url())
    })
    await page.goto("/login")
    await page.waitForLoadState("domcontentloaded")
    expect(loaded.filter((u) => editorChunk.test(u))).toEqual([])
  })
})

test.describe("sheet description", () => {
  async function openSheet(page: Page, body?: string) {
    const { url, project } = await openBoard(page)
    const task = await createTaskViaApi(page, project.id, { title: "Sheet task" })
    if (body !== undefined) {
      const res = await page.request.patch(`/api/tasks/${task.id}`, { data: { body } })
      expect(res.ok()).toBe(true)
    }
    await page.goto(`${url}?task=${task.id}`)
    const sheet = page.getByRole("dialog", { name: task.key })
    await expect(sheet).toBeVisible()
    await expect(editorHost(sheet)).toHaveAttribute("data-editor", "ready")
    return { sheet, task, url }
  }

  const saved = (page: Page) =>
    page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/tasks\//.test(r.url()))

  test("edits save on blur and persist after reload", async ({ page }) => {
    const { sheet, url, task } = await openSheet(page)
    const editor = description(sheet)
    await editor.click()
    await page.keyboard.type("## Plan")
    await page.keyboard.press("Enter")
    await page.keyboard.type("- one")

    const response = saved(page)
    await sheet.getByRole("textbox", { name: "Task title" }).click() // blur
    const patch = await response
    expect(patch.request().postDataJSON()).toEqual({ body: "## Plan\n- one" })

    await page.goto(`${url}?task=${task.id}`)
    const reloaded = page.getByRole("dialog", { name: task.key })
    await expect(description(reloaded).locator(".cm-lp-h2:not(.cm-lp-syntax)")).toHaveText("Plan")
  })

  test("Escape reverts an unsaved edit and keeps the sheet open", async ({ page }) => {
    const { sheet } = await openSheet(page, "original")
    const editor = description(sheet)
    await expect(editor).toHaveText("original")
    await editor.click()
    await page.keyboard.press("End")
    await page.keyboard.type(" changed")
    await expect(editor).toHaveText("original changed")

    await page.keyboard.press("Escape")
    await expect(sheet).toBeVisible()
    await expect(editor).toHaveText("original")

    // With nothing left to revert, Escape closes the sheet as usual.
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
  })

  test("clearing the description saves it as empty", async ({ page }) => {
    const { sheet } = await openSheet(page, "to be removed")
    const editor = description(sheet)
    await editor.click()
    await page.keyboard.press("ControlOrMeta+a")
    await page.keyboard.press("Backspace")

    const response = saved(page)
    await sheet.getByRole("textbox", { name: "Task title" }).click()
    expect((await response).request().postDataJSON()).toEqual({ body: null })
  })
})
