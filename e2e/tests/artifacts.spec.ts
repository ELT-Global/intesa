import { readFileSync } from "node:fs"
import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail() })
  const slug = await createWorkspace(page, uniqueName())
  const project = await createProject(
    page,
    await workspaceIdBySlug(page, slug),
    uniqueName("Artifacts"),
  )
  const task = await createTaskViaApi(page, project.id, { title: "Artifact task" })
  await page.goto(`/w/${slug}/projects/${project.id}/board?task=${task.id}`)
  const section = page.getByRole("region", { name: "Artifacts" })
  await expect(section).toBeVisible()
  return {
    task,
    section,
    input: section.getByLabel("Upload artifacts"),
    url: `/api/tasks/${task.id}/artifacts`,
  }
}

test("uploads supported formats, places artifacts first, persists and opens HTML safely in a new tab", async ({
  page,
}) => {
  const { section, url } = await setup(page)
  const chooserPromise = page.waitForEvent("filechooser")
  await section.getByRole("button", { name: "Upload artifacts", exact: true }).click()
  await (await chooserPromise).setFiles([
    {
      name: "preview.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        '<h1>Artifact preview – résumé</h1><script>document.body.dataset.executed="yes"</script>',
      ),
    },
    { name: "readme.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes") },
    {
      name: "brief.PDF",
      mimeType: "application/pdf",
      buffer: readFileSync("fixtures/artifacts/brief.pdf"),
    },
    {
      name: "brief.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: readFileSync("fixtures/artifacts/brief.docx"),
    },
    {
      name: "brief.odt",
      mimeType: "application/vnd.oasis.opendocument.text",
      buffer: readFileSync("fixtures/artifacts/brief.odt"),
    },
  ])
  await expect(section.getByRole("listitem")).toHaveCount(5)
  const headings = await page.getByRole("dialog").locator("h3").allTextContents()
  expect(headings.indexOf("Artifacts")).toBeLessThan(headings.indexOf("Subtasks"))
  expect(headings.indexOf("Artifacts")).toBeLessThan(headings.indexOf("Relationships"))
  await page.reload()
  await expect(section.getByRole("listitem")).toHaveCount(5)
  const popupPromise = page.waitForEvent("popup")
  await section.getByRole("link", { name: "preview.html" }).click()
  const popup = await popupPromise
  await expect(popup.getByRole("heading", { name: "Artifact preview – résumé" })).toBeVisible()
  expect(await popup.locator("body").getAttribute("data-executed")).toBeNull()
  await expect(popup).toHaveURL(new RegExp(`${url}/`))
  await popup.close()
  // Chromium's headless shell downloads PDFs; a regular browser can use its PDF viewer.
  const pdfDownload = page.waitForEvent("download")
  await section.getByRole("link", { name: "brief.PDF", exact: true }).click()
  const pdf = await pdfDownload
  expect(pdf.suggestedFilename()).toBe("brief.PDF")
  expect(readFileSync(await pdf.path())).toEqual(readFileSync("fixtures/artifacts/brief.pdf"))
  for (const name of ["brief.PDF", "brief.docx", "brief.odt"]) {
    const link = section.getByRole("link", { name, exact: true })
    await expect(link).toHaveAttribute("target", "_blank")
    const response = await page.request.get((await link.getAttribute("href")) as string)
    expect(response.ok()).toBe(true)
    expect((await response.body()).length).toBeGreaterThan(0)
  }
})

test("dragged Markdown opens in an editable modal, saves a replacement, and cancels without changing it", async ({
  page,
}) => {
  const { section, url } = await setup(page)
  await section.getByRole("group", { name: "Drop artifacts" }).evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(["# Dropped notes"], "notes.md", { type: "text/markdown" }))
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: transfer }))
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }))
  })
  await section.getByRole("button", { name: "notes.md", exact: true }).click()
  const modal = page.getByRole("dialog", { name: "notes.md", exact: true })
  const editor = modal.getByRole("textbox", { name: "Artifact Markdown" })
  await expect(editor).toBeVisible()
  // Wait for the editor's lazy CodeMirror handoff before editing.
  await expect(modal.locator('[data-editor="ready"]')).toBeVisible()
  await editor.fill("# Updated notes\n\nSaved from the modal.")
  await modal.getByRole("button", { name: "Save artifact" }).click()
  await expect(modal).toBeHidden()
  await page.reload()
  await section.getByRole("button", { name: "notes.md", exact: true }).click()
  await expect(modal.locator('[data-editor="ready"]')).toBeVisible()
  await expect(editor).toContainText("Saved from the modal.")
  await editor.fill("Discard this edit")
  await modal.getByRole("button", { name: "Cancel" }).click()
  await section.getByRole("button", { name: "notes.md", exact: true }).click()
  await expect(editor).toContainText("Saved from the modal.")
  const { artifacts } = await (await page.request.get(url)).json()
  expect(artifacts).toHaveLength(1)
  expect(await (await page.request.get(`${url}/${artifacts[0].id}`)).text()).toBe(
    "# Updated notes\n\nSaved from the modal.",
  )
})

test("validates selections and drops in the client and surfaces server content rejection", async ({
  page,
}) => {
  const { section, input, url } = await setup(page)
  let writes = 0
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith(url)) writes++
  })
  for (const file of [
    { name: "script.js", mimeType: "text/javascript", buffer: Buffer.from("alert(1)") },
    { name: "huge.md", mimeType: "text/markdown", buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 120) },
    { name: "mismatch.pdf", mimeType: "text/html", buffer: Buffer.from("%PDF-1.7") },
  ]) {
    await input.setInputFiles(file)
    await expect(section.getByRole("alert")).toBeVisible()
  }
  await section.getByRole("group", { name: "Drop artifacts" }).evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(["binary"], "program.exe"))
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }))
  })
  await expect(section.getByRole("alert")).toContainText("program.exe")
  expect(writes).toBe(0)
  await input.setInputFiles({
    name: "fake.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a PDF"),
  })
  await expect(section.getByRole("alert")).toContainText("content does not match")
  expect(writes).toBe(1)
  expect((await (await page.request.get(url)).json()).artifacts).toEqual([])
  // A failed upload must leave the input usable, including selecting the same name again.
  await input.setInputFiles({
    name: "fake.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n%%EOF"),
  })
  await expect(section.getByRole("link", { name: "fake.pdf" })).toBeVisible()
  await expect(section.getByRole("alert")).toHaveCount(0)
})

test("a failed Markdown save keeps edits available for retry", async ({ page }) => {
  const { section, input } = await setup(page)
  await input.setInputFiles({
    name: "retry.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Original"),
  })
  await section.getByRole("button", { name: "retry.md", exact: true }).click()
  const modal = page.getByRole("dialog", { name: "retry.md", exact: true })
  await expect(modal.locator('[data-editor="ready"]')).toBeVisible()
  const editor = modal.getByRole("textbox", { name: "Artifact Markdown" })
  await editor.fill("Keep this draft")
  await page.route("**/artifacts/*", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({ status: 500, json: { code: "INTERNAL", message: "Save failed" } })
    else await route.continue()
  })
  await modal.getByRole("button", { name: "Save artifact" }).click()
  await expect(modal.getByRole("alert")).toContainText("Save failed")
  await expect(editor).toContainText("Keep this draft")
  await page.unroute("**/artifacts/*")
  await modal.getByRole("button", { name: "Save artifact" }).click()
  await expect(modal).toBeHidden()
  await section.getByRole("button", { name: "retry.md", exact: true }).click()
  await expect(editor).toContainText("Keep this draft")
})
