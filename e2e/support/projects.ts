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

/** Creates a project through the API and returns its id and key. */
export async function createProject(
  page: Page,
  workspaceId: string,
  name: string,
): Promise<{ id: string; key: string }> {
  const res = await page.request.post(`/api/workspaces/${workspaceId}/projects`, {
    data: { name },
  })
  expect(res.status()).toBe(201)
  const { project } = (await res.json()) as { project: { id: string; key: string } }
  return project
}

/** Creates a task through the API. */
export async function createTaskViaApi(
  page: Page,
  projectId: string,
  input: { title: string; status?: string },
): Promise<{ id: string; key: string }> {
  const res = await page.request.post(`/api/projects/${projectId}/tasks`, { data: input })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { task: { id: string; key: string } }).task
}
