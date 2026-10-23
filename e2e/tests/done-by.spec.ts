import { type Browser, expect, type Page, test } from "@playwright/test"
import { workspaceWithMember } from "../support/members"
import { createProject, createTaskViaApi } from "../support/projects"
import { answer, column, completeDialog, moveDialog } from "../support/status-change"

// Wide enough for all five columns, so a drag onto the last one lands.
test.use({ viewport: { width: 1800, height: 900 } })

const card = (page: Page, col: string, title: string) =>
  column(page, col).getByRole("button", { name: new RegExp(title) })

type Owner = "ada" | "grace" | null

/** Ada (signed in) and Grace share a workspace; each task is assigned to `owner`. */
async function setup(
  page: Page,
  browser: Browser,
  tasks: { title: string; status?: string; owner: Owner }[],
) {
  const { slug, workspaceId, adaId, graceId } = await workspaceWithMember(page, browser)
  const project = await createProject(page, workspaceId, "Project")
  const ids = { ada: adaId, grace: graceId }
  const created = []
  for (const { owner, ...t } of tasks) {
    const assigneeIds = owner ? [ids[owner]] : undefined
    created.push(await createTaskViaApi(page, project.id, { ...t, assigneeIds }))
  }
  const base = `/w/${slug}/projects/${project.id}`
  await page.goto(`${base}/board`)
  return { slug, base, project, tasks: created, adaId, graceId }
}

/** The body of the next PATCH to a task. */
const nextPatch = (page: Page) =>
  page
    .waitForRequest((r) => r.method() === "PATCH" && /\/api\/tasks\/[^/]+$/.test(r.url()))
    .then((r) => r.postDataJSON() as Record<string, unknown>)

test("moving someone else's task asks who did it; Me reassigns it in the same request", async ({
  page,
  browser,
}) => {
  const { adaId } = await setup(page, browser, [{ title: "Their work", owner: "grace" }])
  const patch = nextPatch(page)
  await card(page, "Todo", "Their work").dragTo(column(page, "In progress"))

  const dialog = moveDialog(page)
  await expect(dialog).toBeVisible()
  const group = dialog.getByRole("group", { name: "Who did it?" })
  await expect(group.getByRole("button", { name: "Grace Hopper" })).toBeVisible()
  // Nothing is chosen for the person, and nothing has moved yet.
  await expect(dialog.getByRole("button", { name: "Move", exact: true })).toBeDisabled()
  await expect(page.locator('section[aria-label="In progress"] [data-task-id]')).toHaveCount(0)

  await group.getByRole("button", { name: "Me" }).click()
  await dialog.getByRole("button", { name: "Move", exact: true }).click()
  expect(await patch).toMatchObject({ status: "in_progress", assigneeIds: [adaId] })

  const moved = card(page, "In progress", "Their work")
  await expect(moved).toBeVisible()
  await expect(moved.getByRole("img", { name: "Ada Lovelace" })).toBeVisible()
  await expect(moved.getByRole("img", { name: "Grace Hopper" })).toHaveCount(0)
})

test("choosing the assignee moves the task and keeps them", async ({ page, browser }) => {
  await setup(page, browser, [{ title: "Their work", owner: "grace" }])
  const patch = nextPatch(page)
  await card(page, "Todo", "Their work").dragTo(column(page, "Review"))

  const dialog = moveDialog(page)
  await dialog.getByRole("button", { name: "Grace Hopper" }).click()
  await dialog.getByRole("button", { name: "Move", exact: true }).click()
  const body = await patch
  expect(body).toMatchObject({ status: "review" })
  expect(body).not.toHaveProperty("assigneeIds")

  const moved = card(page, "Review", "Their work")
  await expect(moved.getByRole("img", { name: "Grace Hopper" })).toBeVisible()
})

test("cancelling changes nothing", async ({ page, browser }) => {
  const { base } = await setup(page, browser, [{ title: "Their work", owner: "grace" }])
  const patches: string[] = []
  page.on("request", (r) => {
    if (r.method() === "PATCH") patches.push(r.url())
  })
  await card(page, "Todo", "Their work").dragTo(column(page, "In progress"))
  await moveDialog(page).getByRole("button", { name: "Cancel" }).click()
  await expect(moveDialog(page)).toBeHidden()

  await expect(card(page, "Todo", "Their work")).toBeVisible()
  await expect(
    card(page, "Todo", "Their work").getByRole("img", { name: "Grace Hopper" }),
  ).toBeVisible()
  expect(patches).toHaveLength(0)
  await page.goto(`${base}/board`)
  await expect(card(page, "Todo", "Their work")).toBeVisible()
})

test("cancelling the three-question Complete dialog leaves everything untouched", async ({
  page,
  browser,
}) => {
  await setup(page, browser, [{ title: "Their work", status: "review", owner: "grace" }])
  const patches: string[] = []
  page.on("request", (r) => {
    if (r.method() === "PATCH") patches.push(r.url())
  })
  await card(page, "Review", "Their work").dragTo(column(page, "Complete"))
  const dialog = completeDialog(page)
  await answer(page, "Reviewed by", /Grace Hopper/)
  await dialog.getByRole("button", { name: "Me" }).click()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()

  const kept = card(page, "Review", "Their work")
  await expect(kept.getByRole("img", { name: "Grace Hopper" })).toBeVisible()
  await expect(column(page, "Complete").getByRole("button", { name: /Their work/ })).toHaveCount(0)
  expect(patches).toHaveLength(0)
})

test("moving a parent someone else owns still offers to update its subtasks afterwards", async ({
  page,
  browser,
}) => {
  const { project, tasks, graceId } = await setup(page, browser, [
    { title: "Their parent", owner: "grace" },
  ])
  await createTaskViaApi(page, project.id, {
    title: "Child work",
    parentTaskId: tasks[0]?.id,
    assigneeIds: [graceId],
  })
  await page.reload()
  await card(page, "Todo", "Their parent").dragTo(column(page, "In progress"))
  const dialog = moveDialog(page)
  await dialog.getByRole("button", { name: "Me" }).click()
  await dialog.getByRole("button", { name: "Move", exact: true }).click()

  const sync = page.getByRole("dialog", { name: "Update subtasks?" })
  await expect(sync).toBeVisible()
  await expect(sync).toContainText("moved to In progress")
})

test("a failed move rolls the card and its assignee back", async ({ page, browser }) => {
  await setup(page, browser, [{ title: "Their work", owner: "grace" }])
  await page.route("**/api/tasks/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "boom" } })
      : route.continue(),
  )
  await card(page, "Todo", "Their work").dragTo(column(page, "In progress"))
  const dialog = moveDialog(page)
  await dialog.getByRole("button", { name: "Me" }).click()
  await dialog.getByRole("button", { name: "Move", exact: true }).click()

  await expect(page.getByRole("alert")).toContainText("Could not save the task.")
  const back = card(page, "Todo", "Their work")
  await expect(back).toBeVisible()
  await expect(back.getByRole("img", { name: "Grace Hopper" })).toBeVisible()
  await expect(back.getByRole("img", { name: "Ada Lovelace" })).toHaveCount(0)
})

test("your own, unassigned, Backlog and Todo moves never ask", async ({ page, browser }) => {
  await setup(page, browser, [
    { title: "Mine", owner: "ada" },
    { title: "Nobody's", owner: null },
    { title: "Their started work", status: "in_progress", owner: "grace" },
    { title: "Their other work", owner: "grace" },
  ])
  await card(page, "Todo", "Mine").dragTo(column(page, "In progress"))
  await expect(card(page, "In progress", "Mine")).toBeVisible()
  await card(page, "Todo", "Nobody's").dragTo(column(page, "Review"))
  await expect(card(page, "Review", "Nobody's")).toBeVisible()
  // Moving out of the way is not claiming the work.
  await card(page, "In progress", "Their started work").dragTo(column(page, "Todo"))
  await expect(card(page, "Todo", "Their started work")).toBeVisible()
  await card(page, "Todo", "Their other work").dragTo(column(page, "Backlog"))
  await expect(card(page, "Backlog", "Their other work")).toBeVisible()

  await expect(moveDialog(page)).toHaveCount(0)
  await expect(completeDialog(page)).toHaveCount(0)
})

test("completing someone else's task asks all three questions in one dialog and one request", async ({
  page,
  browser,
}) => {
  const { adaId, graceId } = await setup(page, browser, [
    { title: "Their work", status: "review", owner: "grace" },
  ])
  const patches: Record<string, unknown>[] = []
  page.on("request", (r) => {
    if (r.method() === "PATCH") patches.push(r.postDataJSON())
  })
  await card(page, "Review", "Their work").dragTo(column(page, "Complete"))

  const dialog = completeDialog(page)
  await expect(dialog.getByRole("group", { name: "Who did it?" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Reviewed by: Not set" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Tested by: Not set" })).toBeVisible()
  const confirm = dialog.getByRole("button", { name: "Complete", exact: true })
  await answer(page, "Reviewed by", /Grace Hopper/)
  await answer(page, "Tested by", "Nobody")
  // Two of three answered is not enough.
  await expect(confirm).toBeDisabled()
  await dialog.getByRole("button", { name: "Me" }).click()
  await confirm.click()

  await expect(card(page, "Complete", "Their work")).toBeVisible()
  expect(patches).toHaveLength(1)
  expect(patches[0]).toMatchObject({
    status: "complete",
    assigneeIds: [adaId],
    reviewedById: graceId,
    testedById: null,
  })
})

test("a subtask of someone else's task asks who did it but not for sign-off", async ({
  page,
  browser,
}) => {
  const { base, project, tasks, adaId, graceId } = await setup(page, browser, [
    { title: "Parent work", owner: null },
  ])
  const parent = tasks[0]
  await createTaskViaApi(page, project.id, {
    title: "Child work",
    parentTaskId: parent?.id,
    assigneeIds: [graceId],
  })
  await page.goto(`${base}/board?task=${parent?.id}`)

  const subtasks = page.getByRole("dialog", { name: parent?.key }).getByRole("region", {
    name: "Subtasks",
  })
  const patch = nextPatch(page)
  await subtasks.getByRole("button", { name: "Change status of Child work" }).click()
  await page.getByRole("menuitemradio", { name: "Complete" }).click()

  const dialog = moveDialog(page)
  await expect(dialog.getByRole("group", { name: "Who did it?" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /^Reviewed by/ })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Me" }).click()
  await dialog.getByRole("button", { name: "Move", exact: true }).click()
  expect(await patch).toMatchObject({ status: "complete", assigneeIds: [adaId] })
  await expect(subtasks).toContainText("1/1")
})

test("the weekly log credits the person who took the task over", async ({ page, browser }) => {
  const { slug } = await setup(page, browser, [{ title: "Their work", owner: "grace" }])
  await card(page, "Todo", "Their work").dragTo(column(page, "In progress"))
  const dialog = moveDialog(page)
  await dialog.getByRole("button", { name: "Me" }).click()
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.ok())
  await dialog.getByRole("button", { name: "Move", exact: true }).click()
  await saved

  await page.goto(`/w/${slug}/log`)
  const ada = page.getByRole("region", { name: "Ada Lovelace" })
  await expect(ada.getByRole("link", { name: /Their work/ })).toBeVisible()
  // Grace still shows it for the time before, with her interval closed.
  const grace = page.getByRole("region", { name: "Grace Hopper" })
  await expect(grace.getByRole("link", { name: /Their work/ })).toContainText("Unassigned")
})
