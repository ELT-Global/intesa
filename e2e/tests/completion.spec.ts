import { type Browser, expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember, pageAs } from "../support/members"
import {
  createProject,
  createTaskViaApi,
  setTaskStatus,
  workspaceIdBySlug,
} from "../support/projects"

// Wide enough for all five columns: the Complete column is the last one, and a drag onto a column
// that is partly scrolled out of view would also set the board scrolling.
test.use({ viewport: { width: 1800, height: 900 } })

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true })
const completeDialog = (page: Page) => page.getByRole("dialog", { name: "Complete task" })

async function userId(page: Page): Promise<string> {
  const res = await page.request.get("/api/me")
  return ((await res.json()) as { user: { id: string } }).user.id
}

/** Ada owns the workspace and Grace is its other member; the tasks are created on the way. */
async function setup(
  page: Page,
  browser: Browser,
  tasks: { title: string; status?: string }[],
  view: "board" | "table" = "board",
) {
  const graceEmail = uniqueEmail("grace")
  await signIn(page, { email: uniqueEmail("ada"), name: "Ada Lovelace" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const grace = await pageAs(browser, graceEmail, "Grace Hopper")
  const graceId = await userId(grace)
  await grace.context().close()
  await addMember(page, workspaceId, graceEmail)
  const adaId = await userId(page)

  const project = await createProject(page, workspaceId, uniqueName("Project"))
  const created = []
  for (const t of tasks) created.push(await createTaskViaApi(page, project.id, t))
  const base = `/w/${slug}/projects/${project.id}`
  await page.goto(`${base}/${view}`)
  return { slug, base, project, tasks: created, adaId, graceId }
}

/** Answers one question of the completion dialog: "Reviewed by"/"Tested by" with a member or "Nobody". */
async function answer(page: Page, question: string, who: string | RegExp) {
  await completeDialog(page)
    .getByRole("button", { name: new RegExp(`^${question}:`) })
    .click()
  await page.getByRole("option", { name: who }).click()
  // The picker animates out; the next one must not find its options.
  await expect(page.getByRole("option")).toHaveCount(0)
}

async function answerBoth(page: Page, reviewer: string | RegExp, tester: string | RegExp) {
  await answer(page, "Reviewed by", reviewer)
  await answer(page, "Tested by", tester)
}

test("dragging a card to Complete asks first; Cancel leaves it where it was", async ({
  page,
  browser,
}) => {
  const { base } = await setup(page, browser, [{ title: "Ship feature" }, { title: "Other work" }])
  const patches: string[] = []
  page.on("request", (r) => {
    if (r.method() === "PATCH") patches.push(r.url())
  })
  await column(page, "Todo")
    .getByRole("button", { name: /Ship feature/ })
    .dragTo(column(page, "Complete"))

  const dialog = completeDialog(page)
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("Ship feature")
  // Nothing is shown as moved while the question is open, and nothing can be confirmed unanswered.
  // (The modal hides the board from the accessibility tree, so the columns are found by markup.)
  const inColumn = (name: string) => page.locator(`section[aria-label="${name}"] [data-task-id]`)
  await expect(inColumn("Todo")).toHaveCount(2)
  await expect(inColumn("Complete")).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Complete" })).toBeDisabled()

  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()
  await expect(column(page, "Todo").getByRole("button", { name: /Ship feature/ })).toBeVisible()
  await expect(column(page, "Complete").getByRole("button", { name: /Ship feature/ })).toHaveCount(
    0,
  )

  // The page is still usable (no stuck pointer-events), and the task really did not change.
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none")
  await column(page, "Todo")
    .getByRole("button", { name: /Other work/ })
    .click({ timeout: 2000 })
  await expect(page).toHaveURL(/task=/)
  expect(patches).toHaveLength(0)
  await page.goto(`${base}/board`)
  await expect(column(page, "Todo").getByRole("button", { name: /Ship feature/ })).toBeVisible()
})

test("confirming with a member and Nobody completes the task and the sheet shows both", async ({
  page,
  browser,
}) => {
  const { tasks, graceId } = await setup(page, browser, [{ title: "Ship feature" }])
  const task = tasks[0]
  await column(page, "Todo")
    .getByRole("button", { name: /Ship feature/ })
    .dragTo(column(page, "Complete"))

  const dialog = completeDialog(page)
  await expect(dialog.getByRole("button", { name: "Reviewed by: Not set" })).toBeVisible()
  await answer(page, "Reviewed by", /Grace Hopper/)
  await expect(dialog.getByRole("button", { name: "Reviewed by: Grace Hopper" })).toBeVisible()
  // One answer is not enough.
  await expect(dialog.getByRole("button", { name: "Complete" })).toBeDisabled()
  await answer(page, "Tested by", "Nobody")
  await expect(dialog.getByRole("button", { name: "Tested by: Nobody" })).toBeVisible()

  // One request carries the move and both answers.
  const sent = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith(`/api/tasks/${task?.id}`),
  )
  await dialog.getByRole("button", { name: "Complete" }).click()
  expect((await sent).postDataJSON()).toMatchObject({
    status: "complete",
    reviewedById: graceId,
    testedById: null,
  })
  await expect(dialog).toBeHidden()
  const card = column(page, "Complete").getByRole("button", { name: /Ship feature/ })
  await expect(card).toBeVisible()

  await page.reload()
  await column(page, "Complete")
    .getByRole("button", { name: /Ship feature/ })
    .click()
  const sheet = page.getByRole("dialog", { name: task?.key })
  await expect(sheet.getByRole("button", { name: "Reviewed by: Grace Hopper" })).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Tested by: Nobody" })).toBeVisible()
})

test("Reviewed by and Tested by are edited from the sheet of a task in Review", async ({
  page,
  browser,
}) => {
  const { base, tasks, graceId } = await setup(page, browser, [
    { title: "In review", status: "review" },
    { title: "Still todo" },
  ])
  const [inReview, todo] = tasks
  await page.goto(`${base}/board?task=${todo?.id}`)
  const todoSheet = page.getByRole("dialog", { name: todo?.key })
  await expect(todoSheet.getByRole("button", { name: "Change status" })).toBeVisible()
  await expect(todoSheet.getByRole("button", { name: /^Reviewed by/ })).toHaveCount(0)

  await page.goto(`${base}/board?task=${inReview?.id}`)
  const sheet = page.getByRole("dialog", { name: inReview?.key })
  await expect(sheet.getByRole("button", { name: "Reviewed by: Not set" })).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Tested by: Not set" })).toBeVisible()

  await sheet.getByRole("button", { name: "Reviewed by: Not set" }).click()
  await page.getByRole("option", { name: /Grace Hopper/ }).click()
  await expect(sheet.getByRole("button", { name: "Reviewed by: Grace Hopper" })).toBeVisible()
  await expect(page.getByRole("option")).toHaveCount(0)
  await sheet.getByRole("button", { name: "Tested by: Not set" }).click()
  await page.getByRole("option", { name: "Nobody" }).click()
  await expect(sheet.getByRole("button", { name: "Tested by: Nobody" })).toBeVisible()
  await expect(page.getByRole("option")).toHaveCount(0)

  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/tasks/${inReview?.id}`)
      const { task } = (await res.json()) as {
        task: { reviewedBy?: { id: string } | null; testedBy?: { id: string } | null }
      }
      return [task.reviewedBy?.id, task.testedBy]
    })
    .toEqual([graceId, null])

  // Both can be changed again, to nobody and to someone.
  await sheet.getByRole("button", { name: "Reviewed by: Grace Hopper" }).click()
  await page.getByRole("option", { name: "Nobody" }).click()
  await expect(sheet.getByRole("button", { name: "Reviewed by: Nobody" })).toBeVisible()

  // Moving it to Complete from the sheet asks, prefilled with the answers it already has.
  await expect(page.getByRole("option")).toHaveCount(0)
  await sheet.getByRole("button", { name: "Change status" }).click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()
  const dialog = completeDialog(page)
  await expect(dialog.getByRole("button", { name: "Reviewed by: Nobody" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Tested by: Nobody" })).toBeVisible()
  await dialog.getByRole("button", { name: "Complete" }).click()
  await expect(dialog).toBeHidden()
  await expect(sheet.getByRole("button", { name: "Change status" })).toContainText("Complete")
  // The fields stay editable on a complete task.
  await expect(sheet.getByRole("button", { name: "Reviewed by: Nobody" })).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Tested by: Nobody" })).toBeVisible()
})

test("Alt+Right into Complete asks first; Escape keeps the card and its focus", async ({
  page,
  browser,
}) => {
  await setup(page, browser, [{ title: "Ship feature", status: "review" }])
  const patches: string[] = []
  page.on("request", (r) => {
    if (r.method() === "PATCH") patches.push(r.url())
  })
  const card = column(page, "Review").getByRole("button", { name: /Ship feature/ })
  await card.focus()
  await page.keyboard.press("Alt+ArrowRight")

  const dialog = completeDialog(page)
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(card).toBeVisible()
  await expect(card).toBeFocused()
  expect(patches).toHaveLength(0)

  // Again, and this time confirm.
  await page.keyboard.press("Alt+ArrowRight")
  await expect(dialog).toBeVisible()
  await answerBoth(page, "Nobody", "Nobody")
  await dialog.getByRole("button", { name: "Complete" }).click()
  await expect(column(page, "Complete").getByRole("button", { name: /Ship feature/ })).toBeVisible()
})

test("the card menu's Status asks too, and the board stays usable either way", async ({
  page,
  browser,
}) => {
  await setup(page, browser, [{ title: "Ship feature", status: "review" }, { title: "Other work" }])
  const card = column(page, "Review").getByRole("button", { name: /Ship feature/ })
  await card.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Status" }).click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()

  const dialog = completeDialog(page)
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(card).toBeVisible()
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none")
  await column(page, "Todo")
    .getByRole("button", { name: /Other work/ })
    .click({ timeout: 2000 })
  await expect(page).toHaveURL(/task=/)
  await page.keyboard.press("Escape")

  await card.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Status" }).click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()
  await answerBoth(page, /Grace Hopper/, /Ada Lovelace/)
  await dialog.getByRole("button", { name: "Complete" }).click()
  await expect(dialog).toBeHidden()
  await expect(column(page, "Complete").getByRole("button", { name: /Ship feature/ })).toBeVisible()
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none")
})

test("a table row's status picker asks before completing", async ({ page, browser }) => {
  await setup(page, browser, [{ title: "Ship feature" }], "table")
  const row = page.getByRole("row", { name: /Ship feature/ })
  await row.getByRole("button", { name: "Change status" }).click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()

  const dialog = completeDialog(page)
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toContainText("Todo")

  await row.getByRole("button", { name: "Change status" }).click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()
  await answerBoth(page, "Nobody", "Nobody")
  await dialog.getByRole("button", { name: "Complete" }).click()
  await expect(row).toContainText("Complete")
})

test("completing a subtask does not ask, and subtasks have no review fields", async ({
  page,
  browser,
}) => {
  const { base, project, tasks } = await setup(page, browser, [{ title: "Parent work" }])
  const parent = tasks[0]
  if (!parent) throw new Error("seed failed")
  const subtask = await createTaskViaApi(page, project.id, {
    title: "Child work",
    status: "review",
    parentTaskId: parent.id,
  })
  await page.goto(`${base}/board?task=${parent.id}`)

  const subtasks = page.getByRole("dialog", { name: parent.key }).getByRole("region", {
    name: "Subtasks",
  })
  await subtasks.getByRole("button", { name: "Change status of Child work" }).click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()
  await expect(subtasks).toContainText("1/1")
  await expect(completeDialog(page)).toHaveCount(0)

  // Its own sheet: no Reviewed by / Tested by, and its status picker completes it straight away.
  await page.goto(`${base}/board?task=${subtask.id}`)
  const sheet = page.getByRole("dialog", { name: subtask.key })
  await expect(sheet.getByRole("button", { name: "Change status" })).toContainText("Complete")
  await expect(sheet.getByRole("button", { name: /^Reviewed by/ })).toHaveCount(0)
  await sheet.getByRole("button", { name: "Change status" }).click()
  await page.getByRole("menuitemradio", { name: "Todo" }).click()
  await sheet.getByRole("button", { name: "Change status" }).click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()
  await expect(sheet.getByRole("button", { name: "Change status" })).toContainText("Complete")
  await expect(completeDialog(page)).toHaveCount(0)
})

test("a task created in Complete asks who reviewed and tested it", async ({ page, browser }) => {
  await setup(page, browser, [])
  await column(page, "Complete").getByRole("button", { name: "Add task" }).click()
  const composer = page.getByRole("dialog", { name: "New task" })
  await composer.getByLabel("Title").fill("Already shipped")
  await composer.getByRole("button", { name: "Create task" }).click()

  const dialog = completeDialog(page)
  await expect(dialog).toBeVisible()
  await answerBoth(page, "Nobody", /Grace Hopper/)
  await dialog.getByRole("button", { name: "Complete" }).click()
  await expect(
    column(page, "Complete").getByRole("button", { name: /Already shipped/ }),
  ).toBeVisible()
})

test("the weekly log lists a completed task for the person who reviewed or tested it", async ({
  page,
  browser,
}) => {
  const { slug, project, graceId, adaId } = await setup(page, browser, [])
  const done = await createTaskViaApi(page, project.id, {
    title: "Ship feature",
    assigneeIds: [adaId],
  })
  await setTaskStatus(page, done.id, "complete", { reviewedById: graceId, testedById: adaId })

  await page.goto(`/w/${slug}/log`)
  const grace = page.getByRole("region", { name: "Grace Hopper" })
  const checks = grace.getByRole("list", { name: "Reviewed or tested" })
  await expect(checks.getByRole("link", { name: /Ship feature/ })).toContainText(done.key)
  await expect(checks).toContainText("reviewed")
  await expect(checks).not.toContainText("tested")
  // She has no tasks of her own, but she is not "nothing this week".
  await expect(grace.getByRole("list", { name: "Completed" })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Nothing this week" })).toHaveCount(0)

  // Ada did the task and tested it herself, so it shows in both groups.
  const ada = page.getByRole("region", { name: "Ada Lovelace" })
  await expect(ada.getByRole("list", { name: "Completed" })).toContainText("Ship feature")
  await expect(ada.getByRole("list", { name: "Reviewed or tested" })).toContainText("tested")
})

test("completing a task with open subtasks still offers to update them afterwards", async ({
  page,
  browser,
}) => {
  const { base, project, tasks } = await setup(page, browser, [{ title: "Parent work" }])
  await createTaskViaApi(page, project.id, { title: "Child work", parentTaskId: tasks[0]?.id })
  await page.goto(`${base}/board`)
  await column(page, "Todo")
    .getByRole("button", { name: /Parent work/ })
    .dragTo(column(page, "Complete"))
  await answerBoth(page, "Nobody", "Nobody")
  await completeDialog(page).getByRole("button", { name: "Complete" }).click()

  const sync = page.getByRole("dialog", { name: "Update subtasks?" })
  await expect(sync).toBeVisible()
  await expect(sync).toContainText("moved to Complete")
  await sync.getByRole("button", { name: "Set all to Complete" }).click()
  await sync.getByRole("button", { name: "Update 1 subtask" }).click()
  await expect(sync).toHaveCount(0)
})

test("a rejected completion rolls the card and its answers back", async ({ page, browser }) => {
  const { base, tasks } = await setup(page, browser, [{ title: "Ship feature", status: "review" }])
  const task = tasks[0]
  // Open and close the sheet so the task's detail is cached and gets the optimistic answers too.
  await page.goto(`${base}/board?task=${task?.id}`)
  await expect(page.getByRole("dialog", { name: task?.key })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: task?.key })).toBeHidden()

  await page.route("**/api/tasks/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "boom" } })
      : route.continue(),
  )
  await column(page, "Review")
    .getByRole("button", { name: /Ship feature/ })
    .dragTo(column(page, "Complete"))
  await answerBoth(page, /Grace Hopper/, "Nobody")
  await completeDialog(page).getByRole("button", { name: "Complete" }).click()

  await expect(page.getByRole("alert")).toContainText("Could not save the task.")
  await expect(column(page, "Review").getByRole("button", { name: /Ship feature/ })).toBeVisible()
  await expect(column(page, "Complete").getByRole("button", { name: /Ship feature/ })).toHaveCount(
    0,
  )

  await column(page, "Review")
    .getByRole("button", { name: /Ship feature/ })
    .click()
  const sheet = page.getByRole("dialog", { name: task?.key })
  await expect(sheet.getByRole("button", { name: "Change status" })).toContainText("Review")
  await expect(sheet.getByRole("button", { name: "Reviewed by: Not set" })).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Tested by: Not set" })).toBeVisible()
})
