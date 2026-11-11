import { expect, type Locator, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

// A 1×1 PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const project = await createProject(
    page,
    await workspaceIdBySlug(page, slug),
    uniqueName("Images"),
  )
  const task = await createTaskViaApi(page, project.id, { title: "Screenshot task" })
  await page.goto(`/w/${slug}/projects/${project.id}/board?task=${task.id}`)
  const sheet = page.getByRole("dialog")
  await expect(sheet.locator('[data-editor="ready"]')).toBeVisible()
  return { slug, task, sheet, body: sheet.getByRole("textbox", { name: "Description" }) }
}

/** Sends a clipboard or drop event carrying an image file, the way a browser does. */
async function sendImage(target: Locator, kind: "paste" | "drop", name = "image.png") {
  await target.evaluate(
    (element, { kind, name, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], name, { type: "image/png" }))
      const rect = element.getBoundingClientRect()
      const event =
        kind === "paste"
          ? new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: transfer,
            })
          : new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
              clientX: rect.left + 4,
              clientY: rect.top + 4,
            })
      element.dispatchEvent(event)
    },
    { kind, name, base64: PNG_BASE64 },
  )
}

async function savedBody(page: Page, taskId: string) {
  const res = await page.request.get(`/api/tasks/${taskId}`)
  return ((await res.json()) as { task: { body: string | null } }).task.body
}

test("a pasted screenshot is stored, inserted as a Markdown image and rendered after reload", async ({
  page,
}) => {
  const { task, sheet, body } = await setup(page)
  await body.click()
  await body.pressSequentially("Steps to reproduce:")
  await sendImage(body, "paste")
  const image = sheet.locator("img.cm-lp-image")
  await expect(image).toHaveAttribute("alt", /^Screenshot \d{4}-\d{2}-\d{2} at [\d.]+\.png$/)
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
  await body.blur()
  await expect
    .poll(() => savedBody(page, task.id))
    .toMatch(
      /^Steps to reproduce:\n!\[Screenshot [^\]]+\.png\]\(\/api\/tasks\/[\w-]+\/artifacts\/[\w-]+\)$/,
    )

  // The image's bytes come back from the database, and it is not listed among the documents.
  const url = ((await savedBody(page, task.id)) ?? "").match(/\((\/api\/[^)]+)\)/)?.[1] ?? ""
  const response = await page.request.get(url)
  expect(response.headers()["content-type"]).toBe("image/png")
  expect((await response.body()).toString("base64")).toBe(PNG_BASE64)
  await expect(sheet.getByRole("region", { name: "Artifacts" }).getByRole("listitem")).toHaveCount(
    0,
  )

  await page.reload()
  await expect(sheet.locator('[data-editor="ready"]')).toBeVisible()
  await expect(sheet.locator("img.cm-lp-image")).toHaveAttribute("src", url)
})

test("a dropped image that is still uploading on blur is saved once it lands, without its placeholder", async ({
  page,
}) => {
  const { task, sheet, body } = await setup(page)
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**/api/tasks/${task.id}/artifacts`, async (route) => {
    await held
    await route.continue()
  })
  await body.click()
  await sendImage(body, "drop", "design.png")
  await expect(body).toContainText("Uploading design.png")
  await body.blur()
  // Nothing is saved while the placeholder stands in for the image.
  await page.waitForTimeout(300)
  expect(await savedBody(page, task.id)).toBeNull()
  release()
  await expect(sheet.locator("img.cm-lp-image")).toHaveAttribute("alt", "design.png")
  await expect
    .poll(() => savedBody(page, task.id))
    .toMatch(/^!\[design\.png\]\(\/api\/tasks\/[\w-]+\/artifacts\/[\w-]+\)$/)
})

async function storedImages(page: Page, taskId: string) {
  const res = await page.request.get(`/api/tasks/${taskId}/artifacts`)
  return ((await res.json()) as { artifacts: { mimeType: string }[] }).artifacts.filter((a) =>
    a.mimeType.startsWith("image/"),
  ).length
}

test("a screenshot removed from a saved description is deleted", async ({ page }) => {
  const { task, sheet, body } = await setup(page)
  await body.click()
  await body.pressSequentially("Before")
  await sendImage(body, "paste")
  await expect(sheet.locator("img.cm-lp-image")).toBeVisible()
  await body.blur()
  await expect.poll(() => savedBody(page, task.id)).toContain("/artifacts/")
  expect(await storedImages(page, task.id)).toBe(1)

  await body.click()
  await body.press("ControlOrMeta+a")
  await body.pressSequentially("After")
  await body.blur()
  await expect.poll(() => savedBody(page, task.id)).toBe("After")
  expect(await storedImages(page, task.id)).toBe(0)
})

test("a screenshot pasted and removed before the description saves is deleted", async ({
  page,
}) => {
  const { task, sheet, body } = await setup(page)
  await body.click()
  await sendImage(body, "paste")
  await expect(sheet.locator("img.cm-lp-image")).toBeVisible()
  expect(await storedImages(page, task.id)).toBe(1)
  // Escape discards the unsaved edit, image and all.
  await body.press("Escape")
  await body.blur()
  await expect.poll(() => storedImages(page, task.id)).toBe(0)
  expect(await savedBody(page, task.id)).toBeNull()
})

test("a rejected image is reported and leaves the description unchanged", async ({ page }) => {
  const { task, body } = await setup(page)
  await page.route(`**/api/tasks/${task.id}/artifacts`, (route) =>
    route.fulfill({ status: 400, json: { code: "VALIDATION_ERROR", message: "Too big" } }),
  )
  await body.click()
  await sendImage(body, "paste")
  await expect(page.getByText(/Screenshot .*\.png: Too big/)).toBeVisible()
  await expect(body).not.toContainText("Uploading")
  await body.blur()
  expect(await savedBody(page, task.id)).toBeNull()
})

test.describe("in the new task dialog", () => {
  async function openComposer(page: Page) {
    await signIn(page, { email: uniqueEmail() })
    const slug = await createWorkspace(page, uniqueName())
    const project = await createProject(
      page,
      await workspaceIdBySlug(page, slug),
      uniqueName("Images"),
    )
    await page.goto(`/w/${slug}/projects/${project.id}/board`)
    await page.getByRole("button", { name: "New task" }).click()
    const composer = page.getByRole("dialog", { name: "New task" })
    await expect(composer.locator('[data-editor="ready"]')).toBeVisible()
    return { project, composer, body: composer.getByRole("textbox", { name: "Description" }) }
  }

  async function createdTask(page: Page, projectId: string, title: string) {
    await expect(page.getByRole("dialog", { name: "New task" })).toBeHidden()
    const res = await page.request.get(`/api/projects/${projectId}/tasks`)
    const { tasks } = (await res.json()) as { tasks: { id: string; title: string }[] }
    const task = tasks.find((t) => t.title === title)
    if (!task) throw new Error(`no task ${title}`)
    return task
  }

  test("a pasted screenshot is previewed, then stored once the task is created", async ({
    page,
  }) => {
    const { project, composer, body } = await openComposer(page)
    await composer.getByLabel("Title").fill("Broken header")
    await body.click()
    await body.pressSequentially("It overlaps:")
    await sendImage(body, "paste")
    // Nothing is uploaded yet: the preview is the page's own copy.
    await expect(composer.locator("img.cm-lp-image")).toHaveAttribute("src", /^blob:/)
    await expect
      .poll(() =>
        composer.locator("img.cm-lp-image").evaluate((i: HTMLImageElement) => i.naturalWidth),
      )
      .toBe(1)
    await composer.getByRole("button", { name: "Create task" }).click()

    const task = await createdTask(page, project.id, "Broken header")
    expect(await savedBody(page, task.id)).toMatch(
      /^It overlaps:\n!\[Screenshot [^\]]+\.png\]\(\/api\/tasks\/[\w-]+\/artifacts\/[\w-]+\)$/,
    )
    const url = ((await savedBody(page, task.id)) ?? "").match(/\((\/api\/[^)]+)\)/)?.[1] ?? ""
    const image = await page.request.get(url)
    expect((await image.body()).toString("base64")).toBe(PNG_BASE64)
  })

  test("images taken out before creating are never uploaded", async ({ page }) => {
    const { project, composer, body } = await openComposer(page)
    await composer.getByLabel("Title").fill("No picture")
    await body.click()
    await sendImage(body, "paste")
    await expect(composer.locator("img.cm-lp-image")).toBeVisible()
    await body.press("ControlOrMeta+a")
    await body.press("Backspace")
    await body.pressSequentially("Words only")
    await composer.getByRole("button", { name: "Create task" }).click()

    const task = await createdTask(page, project.id, "No picture")
    expect(await savedBody(page, task.id)).toBe("Words only")
    expect(await storedImages(page, task.id)).toBe(0)
  })

  test("an image that cannot be stored is reported and the task keeps its text", async ({
    page,
  }) => {
    const { project, composer, body } = await openComposer(page)
    await page.route("**/api/tasks/*/artifacts", (route) =>
      route.fulfill({ status: 400, json: { code: "VALIDATION_ERROR", message: "Too big" } }),
    )
    await composer.getByLabel("Title").fill("Lost picture")
    await body.click()
    await body.pressSequentially("Before")
    await sendImage(body, "paste", "design.png")
    await expect(composer.locator("img.cm-lp-image")).toBeVisible()
    await composer.getByRole("button", { name: "Create task" }).click()

    await expect(page.getByText("design.png: Too big")).toBeVisible()
    const task = await createdTask(page, project.id, "Lost picture")
    expect(await savedBody(page, task.id)).toBe("Before")
  })
})

test("images dropped on Artifacts are pointed to the description", async ({ page }) => {
  const { sheet } = await setup(page)
  const artifacts = sheet.getByRole("region", { name: "Artifacts" })
  await sendImage(artifacts.getByRole("group", { name: "Drop artifacts" }), "drop", "shot.png")
  await expect(artifacts.getByRole("alert")).toContainText(
    "shot.png: Paste or drop images into the description instead.",
  )
})

test("settings show how much the database takes", async ({ page }) => {
  const { slug } = await setup(page)
  await page.goto(`/w/${slug}/settings`)
  const storage = page.locator("section", { has: page.getByRole("heading", { name: "Storage" }) })
  await expect(storage).toContainText("SQLite database")
  // Instance-wide, so other tests' uploads count too.
  await expect(storage).toContainText(/Screenshots and artifacts\s*[\d.]+ [KMG]?B in \d+ files?/)
  // The e2e server runs on an in-memory database, so there is no disk to report.
  await expect(storage).toContainText("The database is in memory")
})
