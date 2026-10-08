import { expect, type Page } from "@playwright/test"

/** Resolves a workspace id from its slug through the API. */
export async function workspaceIdBySlug(page: Page, slug: string): Promise<string> {
  const res = await page.request.get("/api/workspaces")
  expect(res.ok()).toBe(true)
  const { workspaces } = (await res.json()) as { workspaces: { id: string; slug: string }[] }
  const found = workspaces.find((w) => w.slug === slug)
  if (!found) throw new Error(`workspace ${slug} not found`)
  return found.id
}

export const PREFERENCES_KEY = "intesa-preferences"

/**
 * Saves the board's assignee filter for a project before the app loads, in the same format
 * the app writes. Never overwrites a value the page has since saved itself.
 */
export async function seedBoardAssignees(page: Page, projectId: string, ids: string[]) {
  await page.addInitScript(
    ([key, id, selected]) => {
      try {
        const raw = localStorage.getItem(key)
        const prefs = raw ? JSON.parse(raw) : { v: 1, boardAssignees: {} }
        if (id in prefs.boardAssignees) return
        prefs.boardAssignees[id] = selected
        localStorage.setItem(key, JSON.stringify(prefs))
      } catch {}
    },
    [PREFERENCES_KEY, projectId, ids] as const,
  )
}

/**
 * Opens the Backlog column before the app loads (it is collapsed to a chip by default), in the
 * same format the app writes. Never overwrites a choice the page has since saved itself.
 */
export async function seedBacklogExpanded(page: Page, expanded = true) {
  await page.addInitScript(
    ([key, value]) => {
      try {
        const raw = localStorage.getItem(key as string)
        const prefs = raw ? JSON.parse(raw) : { v: 1, boardAssignees: {} }
        if ("backlogExpanded" in prefs) return
        prefs.backlogExpanded = value
        localStorage.setItem(key as string, JSON.stringify(prefs))
      } catch {}
    },
    [PREFERENCES_KEY, expanded] as const,
  )
}

/**
 * Creates a project through the API and returns its id and key. The board starts on
 * "everyone" so tasks made without an assignee are visible; pass `defaultFilter` to get
 * the app's real default (Me) instead. Backlog starts open; pass `collapsedBacklog` for the real default.
 */
export async function createProject(
  page: Page,
  workspaceId: string,
  name: string,
  {
    defaultFilter = false,
    collapsedBacklog = false,
  }: { defaultFilter?: boolean; collapsedBacklog?: boolean } = {},
): Promise<{ id: string; key: string }> {
  const res = await page.request.post(`/api/workspaces/${workspaceId}/projects`, {
    data: { name },
  })
  expect(res.status()).toBe(201)
  const { project } = (await res.json()) as { project: { id: string; key: string } }
  if (!defaultFilter) await seedBoardAssignees(page, project.id, [])
  if (!collapsedBacklog) await seedBacklogExpanded(page)
  return project
}

/** Creates a task through the API. */
export async function createTaskViaApi(
  page: Page,
  projectId: string,
  input: { title: string; status?: string; assigneeIds?: string[] },
): Promise<{ id: string; key: string }> {
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, { data: input })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { task: { id: string; key: string } }).task
}
