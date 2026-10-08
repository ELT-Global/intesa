import { expect, type Page, test } from "@playwright/test"
import { createWorkspace, signIn, uniqueEmail, uniqueName } from "../support/auth"
import { addMember } from "../support/members"
import {
  createProject,
  createTaskViaApi,
  PREFERENCES_KEY,
  workspaceIdBySlug,
} from "../support/projects"

type Member = { userId: string; email: string; name: string }

/**
 * Owner "Olive" plus teammate "Bob". Four tasks cover every filter outcome:
 * Mine (Olive), Bobs (Bob), Shared (both) and Nobody (unassigned).
 */
async function setup(page: Page) {
  const ownerEmail = uniqueEmail("owner")
  await signIn(page, { email: ownerEmail, name: "Olive Owner" })
  const slug = await createWorkspace(page, uniqueName())
  const workspaceId = await workspaceIdBySlug(page, slug)
  const bobEmail = uniqueEmail("bob")
  await addMember(page, workspaceId, bobEmail)
  const res = await page.request.get(`/api/workspaces/${workspaceId}/members`)
  const { members } = (await res.json()) as { members: Member[] }
  const olive = members.find((m) => m.email === ownerEmail) as Member
  const bob = members.find((m) => m.email === bobEmail) as Member
  expect(olive && bob).toBeTruthy()

  const project = await createProject(page, workspaceId, uniqueName("Project"), {
    defaultFilter: true,
  })
  const make = (title: string, assigneeIds: string[]) =>
    createTaskViaApi(page, project.id, { title, assigneeIds })
  await make("Mine", [olive.userId])
  await make("Bobs", [bob.userId])
  await make("Shared", [olive.userId, bob.userId])
  await make("Nobody", [])
  return { slug, workspaceId, project, olive, bob, url: `/w/${slug}/projects/${project.id}/board` }
}

const cards = (page: Page) => page.locator("[data-task-id]")
const filterButton = (page: Page) => page.getByRole("button", { name: /^Filter by assignee/ })
const popover = (page: Page) => page.getByRole("dialog", { name: "Assignee filter" })

async function expectTitles(page: Page, titles: string[]) {
  await expect.poll(async () => (await cards(page).allInnerTexts()).length).toBe(titles.length)
  for (const title of titles) {
    await expect(page.getByRole("button", { name: new RegExp(`\\b${title}\\b`) })).toBeVisible()
  }
}

async function toggle(page: Page, option: string | RegExp) {
  await filterButton(page).click()
  const item = popover(page).getByRole("option", { name: option })
  const wasSelected = (await item.getAttribute("aria-selected")) === "true"
  await item.click()
  await expect(item).toHaveAttribute("aria-selected", String(!wasSelected))
  await page.keyboard.press("Escape")
  await expect(popover(page)).toBeHidden()
}

const stored = (page: Page, projectId: string) =>
  page.evaluate(
    ([key, id]) => {
      const raw = localStorage.getItem(key as string)
      return raw ? (JSON.parse(raw).boardAssignees?.[id as string] ?? null) : null
    },
    [PREFERENCES_KEY, projectId],
  )

test("defaults to the signed-in user's tasks only", async ({ page }) => {
  const { url } = await setup(page)
  await page.goto(url)
  await expectTitles(page, ["Mine", "Shared"])
  await expect(filterButton(page)).toHaveAccessibleName("Filter by assignee: Me")
  // Hidden tasks are gone from the page, not just visually hidden.
  await expect(page.getByText("Bobs")).toHaveCount(0)
  await expect(page.getByText("Nobody")).toHaveCount(0)
})

test("multi-select shows tasks of any selected assignee", async ({ page }) => {
  const { url, bob } = await setup(page)
  await page.goto(url)
  await toggle(page, new RegExp(bob.email))
  await expectTitles(page, ["Mine", "Bobs", "Shared"])
  await expect(filterButton(page)).toHaveAccessibleName("Filter by assignee: 2 selected")

  // Deselecting Olive leaves only Bob's tasks (Shared still matches through Bob).
  await toggle(page, /Olive Owner/)
  await expectTitles(page, ["Bobs", "Shared"])
  await expect(filterButton(page)).toHaveAccessibleName(`Filter by assignee: ${bob.name}`)
})

test("Unassigned shows only tasks without assignees and combines with people", async ({
  page,
}) => {
  const { url } = await setup(page)
  await page.goto(url)

  await toggle(page, "Unassigned")
  await expectTitles(page, ["Mine", "Shared", "Nobody"])

  await toggle(page, /Olive Owner/)
  await expectTitles(page, ["Nobody"])
  await expect(filterButton(page)).toHaveAccessibleName("Filter by assignee: Unassigned")
})

test("clearing the filter shows everyone's tasks and the clear button goes away", async ({
  page,
}) => {
  const { url } = await setup(page)
  await page.goto(url)
  await expectTitles(page, ["Mine", "Shared"])

  await page.getByRole("button", { name: "Clear assignee filter" }).click()
  await expectTitles(page, ["Mine", "Bobs", "Shared", "Nobody"])
  await expect(filterButton(page)).toHaveAccessibleName("Filter by assignee: Everyone")
  await expect(page.getByRole("button", { name: "Clear assignee filter" })).toHaveCount(0)
})

test("column counts follow the filter", async ({ page }) => {
  const { url } = await setup(page)
  await page.goto(url)
  await expectTitles(page, ["Mine", "Shared"])
  const todo = page.getByRole("region", { name: "Todo", exact: true })
  await expect(todo.getByRole("heading", { name: "Todo" }).locator("xpath=..")).toContainText("2")
  await page.getByRole("button", { name: "Clear assignee filter" }).click()
  await expect(todo.getByRole("heading", { name: "Todo" }).locator("xpath=..")).toContainText("4")
})

test("the choice survives a reload, including an explicit Everyone, and is per project", async ({
  page,
}) => {
  const { url, slug, workspaceId, project } = await setup(page)
  const other = await createProject(page, workspaceId, uniqueName("Other"), { defaultFilter: true })
  await createTaskViaApi(page, other.id, { title: "Orphan" })

  await page.goto(url)
  await toggle(page, "Unassigned")
  await expectTitles(page, ["Mine", "Shared", "Nobody"])
  await page.reload()
  await expectTitles(page, ["Mine", "Shared", "Nobody"])

  await page.getByRole("button", { name: "Clear assignee filter" }).click()
  await expectTitles(page, ["Mine", "Bobs", "Shared", "Nobody"])
  await page.reload()
  // Cleared must stay cleared; it must not snap back to Me.
  await expectTitles(page, ["Mine", "Bobs", "Shared", "Nobody"])
  expect(await stored(page, project.id)).toEqual([])

  // The other project never had a choice saved, so it uses the default (Me): Orphan is hidden.
  await page.goto(`/w/${slug}/projects/${other.id}/board`)
  await expect(filterButton(page)).toHaveAccessibleName("Filter by assignee: Me")
  await expect(page.getByRole("button", { name: /Orphan/ })).toHaveCount(0)
  expect(await stored(page, other.id)).toBeNull()
})

test.describe("unusable saved preferences fall back to Me without breaking the board", () => {
  const garbage: [string, string][] = [
    ["invalid JSON", "{not json"],
    ["a JSON string", '"hello"'],
    ["null", "null"],
    ["an array", "[1,2,3]"],
    ["an unknown version", JSON.stringify({ v: 99, boardAssignees: {} })],
    ["no version", JSON.stringify({ boardAssignees: {} })],
    ["boardAssignees of the wrong type", JSON.stringify({ v: 1, boardAssignees: "x" })],
    ["a project entry of the wrong type", JSON.stringify({ v: 1, boardAssignees: { P: "bob" } })],
    ["non-string ids", JSON.stringify({ v: 1, boardAssignees: { P: [1, null, {}, true] } })],
  ]

  for (const [label, raw] of garbage) {
    test(label, async ({ page }) => {
      const errors: string[] = []
      page.on("pageerror", (e) => errors.push(e.message))
      const { url, project } = await setup(page)
      await page.goto("/")
      // Entries for the real project id, so a "valid" shape would actually apply.
      const value = raw.replaceAll('"P"', JSON.stringify(project.id))
      await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [
        PREFERENCES_KEY,
        value,
      ])
      await page.goto(url)

      await expectTitles(page, ["Mine", "Shared"])
      await expect(filterButton(page)).toHaveAccessibleName("Filter by assignee: Me")
      expect(errors).toEqual([])
      // The filter still works afterwards and saves a clean value.
      await page.getByRole("button", { name: "Clear assignee filter" }).click()
      await expectTitles(page, ["Mine", "Bobs", "Shared", "Nobody"])
      await page.reload()
      await expectTitles(page, ["Mine", "Bobs", "Shared", "Nobody"])
    })
  }
})

test("saved people who left the workspace are dropped and the rest are kept", async ({ page }) => {
  const { url, bob, project } = await setup(page)
  await page.goto("/")
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k as string, v as string),
    [
      PREFERENCES_KEY,
      JSON.stringify({
        v: 1,
        boardAssignees: { [project.id]: ["ghost-user-id", bob.userId, bob.userId] },
      }),
    ],
  )
  await page.goto(url)

  await expectTitles(page, ["Bobs", "Shared"])
  await expect(filterButton(page)).toHaveAccessibleName(`Filter by assignee: ${bob.name}`)
  // The correction is written back so the dead id does not linger.
  await expect.poll(() => stored(page, project.id)).toEqual([bob.userId])
})

test("when every saved person is gone the filter resets to Me and forgets the entry", async ({
  page,
}) => {
  const { url, project } = await setup(page)
  await page.goto("/")
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k as string, v as string),
    [PREFERENCES_KEY, JSON.stringify({ v: 1, boardAssignees: { [project.id]: ["ghost-1", "ghost-2"] } })],
  )
  await page.goto(url)

  await expectTitles(page, ["Mine", "Shared"])
  await expect(filterButton(page)).toHaveAccessibleName("Filter by assignee: Me")
  await expect.poll(() => stored(page, project.id)).toBeNull()
})

test("a saved Everyone is kept even when other saved data is junk", async ({ page }) => {
  const { url, project } = await setup(page)
  await page.goto("/")
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k as string, v as string),
    [
      PREFERENCES_KEY,
      JSON.stringify({ v: 1, boardAssignees: { [project.id]: [], junk: 5, alsoJunk: [1] } }),
    ],
  )
  await page.goto(url)
  await expectTitles(page, ["Mine", "Bobs", "Shared", "Nobody"])
})

test("the board still works when localStorage throws", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  const { url } = await setup(page)
  await page.addInitScript(() => {
    const boom = () => {
      throw new DOMException("blocked", "SecurityError")
    }
    Storage.prototype.getItem = boom
    Storage.prototype.setItem = boom
    Storage.prototype.removeItem = boom
  })
  await page.goto(url)

  await expectTitles(page, ["Mine", "Shared"])
  await page.getByRole("button", { name: "Clear assignee filter" }).click()
  await expectTitles(page, ["Mine", "Bobs", "Shared", "Nobody"])
  expect(errors).toEqual([])
})

test.describe("new tasks are pre-assigned from the filter", () => {
  const composer = (page: Page) => page.getByRole("dialog", { name: "New task" })
  const assigneeButton = (page: Page) =>
    composer(page).getByRole("button", { name: "Change assignees" })

  async function assigneesOf(page: Page, projectId: string, title: string) {
    const res = await page.request.get(`/api/projects/${projectId}/tasks`)
    const { tasks } = (await res.json()) as {
      tasks: { title: string; assignees: { id: string }[] }[]
    }
    const task = tasks.find((t) => t.title === title)
    expect(task, `task ${title} exists`).toBeTruthy()
    return (task?.assignees ?? []).map((a) => a.id).sort()
  }

  async function create(page: Page, title: string) {
    await composer(page).getByLabel("Title").fill(title)
    await composer(page).getByRole("button", { name: "Create task" }).click()
    await expect(composer(page)).toBeHidden()
  }

  test("with the default filter the creator is pre-selected and the card stays visible", async ({
    page,
  }) => {
    const { url, olive, project } = await setup(page)
    await page.goto(url)
    await page.getByRole("button", { name: "New task" }).click()
    await expect(assigneeButton(page)).toContainText("Olive Owner")
    await create(page, "Fresh")

    await expectTitles(page, ["Mine", "Shared", "Fresh"])
    expect(await assigneesOf(page, project.id, "Fresh")).toEqual([olive.userId])
  })

  test("with one other person selected, that person is pre-selected, not the creator", async ({
    page,
  }) => {
    const { url, olive, bob, project } = await setup(page)
    await page.goto(url)
    await toggle(page, new RegExp(bob.email))
    await toggle(page, /Olive Owner/)
    await expectTitles(page, ["Bobs", "Shared"])

    await page.getByRole("button", { name: "New task" }).click()
    await expect(assigneeButton(page)).toContainText(bob.name)
    await expect(assigneeButton(page)).not.toContainText("Olive")
    await create(page, "For Bob")

    await expectTitles(page, ["Bobs", "Shared", "For Bob"])
    expect(await assigneesOf(page, project.id, "For Bob")).toEqual([bob.userId])
    expect(await assigneesOf(page, project.id, "For Bob")).not.toContain(olive.userId)
  })

  test("with several people selected, the creator is pre-selected", async ({ page }) => {
    const { url, olive, bob, project } = await setup(page)
    await page.goto(url)
    await toggle(page, new RegExp(bob.email))
    await toggle(page, /Olive Owner/)
    await toggle(page, "Unassigned") // Bob + Unassigned: two entries, creator is neither

    await page.getByRole("button", { name: "New task" }).click()
    await expect(assigneeButton(page)).toContainText("Olive Owner")
    await create(page, "Multi")
    expect(await assigneesOf(page, project.id, "Multi")).toEqual([olive.userId])
  })

  test("with only Unassigned selected the new task starts unassigned", async ({ page }) => {
    const { url, project } = await setup(page)
    await page.goto(url)
    await toggle(page, "Unassigned")
    await toggle(page, /Olive Owner/)
    await expectTitles(page, ["Nobody"])

    await page.getByRole("button", { name: "New task" }).click()
    await expect(assigneeButton(page)).toContainText("Assign")
    await expect(assigneeButton(page)).not.toContainText("Olive")
    await create(page, "Orphan")
    await expectTitles(page, ["Nobody", "Orphan"])
    expect(await assigneesOf(page, project.id, "Orphan")).toEqual([])
  })

  test("with Everyone selected the creator is pre-selected", async ({ page }) => {
    const { url, olive, project } = await setup(page)
    await page.goto(url)
    await page.getByRole("button", { name: "Clear assignee filter" }).click()
    await page.getByRole("button", { name: "New task" }).click()
    await expect(assigneeButton(page)).toContainText("Olive Owner")
    await create(page, "Everyone's")
    expect(await assigneesOf(page, project.id, "Everyone's")).toEqual([olive.userId])
  })

  test("a column's Add task button is pre-selected too, and the choice can be changed", async ({
    page,
  }) => {
    const { url, bob, project } = await setup(page)
    await page.goto(url)
    await toggle(page, new RegExp(bob.email))
    await toggle(page, /Olive Owner/)
    await page
      .getByRole("region", { name: "Review", exact: true })
      .getByRole("button", { name: "Add task" })
      .click()
    await expect(assigneeButton(page)).toContainText(bob.name)

    // Un-assigning in the composer is respected rather than re-applied.
    await assigneeButton(page).click()
    await page.getByRole("dialog", { name: "Assignees" }).getByRole("option", { name: new RegExp(bob.email) }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Assignees" })).toBeHidden()
    await expect(assigneeButton(page)).toContainText("Assign")
    await create(page, "Nobody's review")
    expect(await assigneesOf(page, project.id, "Nobody's review")).toEqual([])
  })

  test("a saved person who is no longer a member is ignored", async ({ page }) => {
    const { url, olive, project } = await setup(page)
    await page.goto("/")
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k as string, v as string),
      [PREFERENCES_KEY, JSON.stringify({ v: 1, boardAssignees: { [project.id]: ["ghost-id"] } })],
    )
    await page.goto(url)
    await page.getByRole("button", { name: "New task" }).click()
    await expect(assigneeButton(page)).toContainText("Olive Owner")
    await create(page, "After ghost")
    expect(await assigneesOf(page, project.id, "After ghost")).toEqual([olive.userId])
  })
})
