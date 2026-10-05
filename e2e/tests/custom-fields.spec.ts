import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { createProject, createTaskViaApi, workspaceIdBySlug } from "../support/projects"

async function setup(page: Page) {
  await signIn(page, { email: uniqueEmail("owner"), name: "Olive Owner" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const project = await createProject(page, workspaceId, uniqueName("Fields"))
  await createTaskViaApi(page, project.id, { title: "Fielded task" })
  await page.goto(`/w/${slug}/projects/${project.id}/board`)
}

const fieldsDialog = (page: Page) => page.getByRole("dialog", { name: "Custom fields" })
const sheet = (page: Page) => page.getByRole("dialog", { name: /-1$/ })

async function openFieldsDialog(page: Page) {
  await page.getByRole("button", { name: "Project options" }).click()
  await page.getByRole("menuitem", { name: "Custom fields…" }).click()
  await expect(fieldsDialog(page)).toBeVisible()
}

async function addField(
  page: Page,
  name: string,
  type: "Text" | "Number" | "Checkbox" | "Date" | "Select",
  opts: { required?: boolean; options?: string[] } = {},
) {
  const form = fieldsDialog(page).getByRole("form", { name: "New field" })
  await form.getByLabel("Field name").fill(name)
  await form.getByLabel("Field type").selectOption({ label: type })
  if (opts.options) await form.getByLabel("Field options").fill(opts.options.join("\n"))
  if (opts.required) await form.getByLabel("Required field").check()
  await form.getByRole("button", { name: "Add field" }).click()
  await expect(
    fieldsDialog(page).getByRole("list", { name: "Fields" }).getByLabel(`Name of ${name}`),
  ).toBeVisible()
}

async function openTask(page: Page) {
  await page.getByRole("button", { name: /Fielded task/ }).click()
  await expect(sheet(page)).toBeVisible()
}

test("each field type can be set on a task and persists after reload", async ({ page }) => {
  await setup(page)
  await openFieldsDialog(page)
  await addField(page, "Notes", "Text")
  await addField(page, "Points", "Number")
  await addField(page, "Blocked", "Checkbox")
  await addField(page, "Ship date", "Date")
  await addField(page, "Stage", "Select", { options: ["Alpha", "Beta"] })
  await page.keyboard.press("Escape")

  await openTask(page)
  const s = sheet(page)
  await s.getByRole("textbox", { name: "Notes", exact: true }).fill("Remember the milk")
  await s.getByRole("textbox", { name: "Points", exact: true }).fill("13.5")
  await s.getByRole("textbox", { name: "Points", exact: true }).blur()
  await s.getByRole("checkbox", { name: "Blocked" }).check()
  await s.getByLabel("Ship date", { exact: true }).fill("2030-01-15")
  await s.getByRole("combobox", { name: "Stage" }).selectOption("Beta")
  await expect(s.getByRole("combobox", { name: "Stage" })).toHaveValue("Beta")
  await page.waitForLoadState("networkidle")

  await page.reload()
  const after = sheet(page)
  await expect(after.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue(
    "Remember the milk",
  )
  await expect(after.getByRole("textbox", { name: "Points", exact: true })).toHaveValue("13.5")
  await expect(after.getByRole("checkbox", { name: "Blocked" })).toBeChecked()
  await expect(after.getByLabel("Ship date", { exact: true })).toHaveValue("2030-01-15")
  await expect(after.getByRole("combobox", { name: "Stage" })).toHaveValue("Beta")
})

test("an invalid number is rejected in the browser and not saved", async ({ page }) => {
  await setup(page)
  await openFieldsDialog(page)
  await addField(page, "Points", "Number")
  await page.keyboard.press("Escape")

  await openTask(page)
  const points = sheet(page).getByRole("textbox", { name: "Points", exact: true })
  await points.fill("twelve")
  await points.blur()
  await expect(sheet(page).getByRole("alert")).toHaveText("Enter a valid number.")

  await page.waitForLoadState("networkidle")
  await page.reload()
  await expect(sheet(page).getByRole("textbox", { name: "Points", exact: true })).toHaveValue("")
})

test("a required field hints when empty and refuses to be cleared", async ({ page }) => {
  await setup(page)
  await openFieldsDialog(page)
  await addField(page, "Team", "Text", { required: true })
  await page.keyboard.press("Escape")

  await openTask(page)
  const team = sheet(page).getByRole("textbox", { name: "Team", exact: true })
  await expect(sheet(page).getByText("Required", { exact: true })).toBeVisible()
  await team.fill("Core")
  await team.blur()
  await expect(sheet(page).getByText("Required", { exact: true })).toHaveCount(0)
  await page.waitForLoadState("networkidle")

  await team.fill("")
  await team.blur()
  await expect(sheet(page).getByText("Could not save Team.")).toBeVisible()
  await expect(sheet(page).getByRole("textbox", { name: "Team", exact: true })).toHaveValue("Core")
})

test("deleting a field removes it from the sheet; dropping an option clears its value", async ({
  page,
}) => {
  await setup(page)
  await openFieldsDialog(page)
  await addField(page, "Stage", "Select", { options: ["Alpha", "Beta"] })
  await addField(page, "Scratch", "Text")
  await page.keyboard.press("Escape")

  await openTask(page)
  await sheet(page).getByRole("combobox", { name: "Stage" }).selectOption("Beta")
  await expect(sheet(page).getByRole("combobox", { name: "Stage" })).toHaveValue("Beta")
  await page.waitForLoadState("networkidle")
  await page.keyboard.press("Escape")

  await openFieldsDialog(page)
  const options = fieldsDialog(page).getByLabel("Options of Stage")
  await options.fill("Alpha")
  await options.blur()
  await expect(fieldsDialog(page).getByLabel("Options of Stage")).toHaveValue("Alpha")
  await fieldsDialog(page).getByRole("button", { name: "Delete field Scratch" }).click()
  await fieldsDialog(page).getByRole("button", { name: "Confirm delete" }).click()
  await expect(fieldsDialog(page).getByLabel("Name of Scratch")).toHaveCount(0)
  await page.keyboard.press("Escape")

  await openTask(page)
  await expect(sheet(page).getByRole("combobox", { name: "Stage" })).toHaveValue("")
  await expect(sheet(page).getByRole("textbox", { name: "Scratch", exact: true })).toHaveCount(0)
})
