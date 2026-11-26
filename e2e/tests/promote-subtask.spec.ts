import { expect, type Page, test } from "@playwright/test"
import { uniqueName } from "../support/auth"
import { workspaceWithMember } from "../support/members"
import { createProject, createTaskViaApi } from "../support/projects"

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true })

test("a subtask becomes a task on the board, assigned to the person picked", async ({
  page,
  browser,
}) => {
  const { slug, workspaceId, adaId } = await workspaceWithMember(page, browser)
  const project = await createProject(page, workspaceId, uniqueName("Project"))
  const board = `/w/${slug}/projects/${project.id}/board`
  await createTaskViaApi(page, project.id, { title: "Already started", status: "in_progress" })
  const parent = await createTaskViaApi(page, project.id, { title: "Launch plan" })
  const child = await createTaskViaApi(page, project.id, {
    title: "Write the copy",
    parentTaskId: parent.id,
    status: "in_progress",
    assigneeIds: [adaId],
  })
  await createTaskViaApi(page, project.id, { title: "Pick a date", parentTaskId: parent.id })

  await page.goto(`${board}?task=${parent.id}`)
  const sheet = page.getByRole("dialog", { name: parent.key })
  const subtasks = sheet.getByRole("region", { name: "Subtasks" })
  await expect(subtasks).toContainText("0/2")
  await subtasks.getByRole("button", { name: "Actions for Write the copy" }).click()
  await page.getByRole("menuitem", { name: "Convert to task" }).click()

  // The current assignee is the default; switch to Grace.
  const convert = page.getByRole("dialog", { name: "Convert to task" })
  await expect(convert).toContainText(`${child.key} will no longer be a subtask of ${parent.key}`)
  await expect(convert.getByRole("button", { name: "Change assignees" })).toHaveText(/Ada Lovelace/)
  await convert.getByRole("button", { name: "Change assignees" }).click()
  const people = page.getByRole("dialog", { name: "Assignees" })
  await people.getByRole("option", { name: /Ada Lovelace/ }).click()
  await people.getByRole("option", { name: /Grace Hopper/ }).click()
  await page.keyboard.press("Escape")
  await expect(people).toBeHidden()
  await expect(convert.getByRole("button", { name: "Change assignees" })).toHaveText(/Grace Hopper/)
  await convert.getByRole("button", { name: "Convert to task" }).click()

  const done = page.getByRole("dialog", { name: `${child.key} is now a task` })
  await expect(done).toContainText("In progress")

  // Opened from the dialog, it is a top-level task: no parent, and it can take subtasks.
  await done.getByRole("button", { name: "Open task" }).click()
  const own = page.getByRole("dialog", { name: child.key })
  await expect(own).toBeVisible()
  await expect(own.getByRole("button", { name: /Parent:/ })).toHaveCount(0)
  await expect(own.getByLabel("Add subtask")).toBeVisible()
  await expect(own.getByRole("button", { name: "Change assignees" })).toHaveText(/Grace Hopper/)

  // After a reload the card sits at the top of its status column and the parent counts one subtask.
  await page.goto(board)
  const inProgress = column(page, "In progress").getByRole("button", {
    name: /Write the copy|Already started/,
  })
  await expect(inProgress).toHaveCount(2)
  await expect(inProgress.first()).toContainText("Write the copy")
  await expect(column(page, "Todo").getByRole("button", { name: /Launch plan/ })).toContainText(
    "0/1",
  )
  await page.goto(`${board}?task=${parent.id}`)
  await expect(subtasks).toContainText("0/1")
  await expect(subtasks.getByRole("button", { name: "Open Pick a date" })).toBeVisible()
  await expect(subtasks.getByRole("button", { name: "Open Write the copy" })).toHaveCount(0)
})
