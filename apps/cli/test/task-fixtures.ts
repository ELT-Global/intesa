import { addMember, signIn, userId } from "../../api/test/helpers"
import { loginAs, sandbox, type TestServer } from "./helpers"

let n = 0

// A signed-in sandbox whose user ("Alan Owner") owns one workspace with a WEB project, plus
// shortcuts that seed data straight through the API.
export async function taskWorld(server: TestServer) {
  const id = `tw${++n}-${crypto.randomUUID().slice(0, 6)}`
  const box = sandbox(server.url)
  const email = `${id}@example.com`
  const { session } = await loginAs(box, server, email)
  await session.call("PATCH", "/api/me", { name: "Alan Owner" })
  const workspace = (await session.call("POST", "/api/workspaces", { name: "Acme", slug: id })).body
    .workspace as { id: string; slug: string }
  const me = await userId(server, email)

  const addProject = async (name: string, key: string) =>
    (await session.call("POST", `/api/workspaces/${workspace.id}/projects`, { name, key })).body
      .project as { id: string; key: string }
  const project = await addProject("Web", "WEB")

  // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary response shapes
  type Json = any
  const addTask = async (body: Record<string, unknown>, projectId = project.id): Promise<Json> => {
    const res = await session.call("POST", `/api/projects/${projectId}/tasks`, body)
    if (res.status !== 201) throw new Error(`task creation failed: ${JSON.stringify(res.body)}`)
    return res.body.task
  }
  const getTask = async (taskId: string): Promise<Json> =>
    (await session.call("GET", `/api/tasks/${taskId}`)).body?.task
  const patchTask = async (taskId: string, body: Record<string, unknown>) =>
    session.call("PATCH", `/api/tasks/${taskId}`, body)
  const addTag = async (name: string) =>
    (await session.call("POST", `/api/workspaces/${workspace.id}/tags`, { name })).body.tag as {
      id: string
      name: string
    }
  const tags = async () =>
    (await session.call("GET", `/api/workspaces/${workspace.id}/tags`)).body.tags as {
      id: string
      name: string
    }[]
  const addField = async (body: Record<string, unknown>, projectId = project.id) =>
    (await session.call("POST", `/api/projects/${projectId}/custom-fields`, body)).body.field as {
      id: string
      name: string
    }
  // Another person in the workspace.
  const addPerson = async (name: string) => {
    const personEmail = `${name.split(" ")[0]?.toLowerCase()}-${id}@example.com`
    await signIn(server.app, personEmail, name)
    const personId = await addMember(server, workspace.id, personEmail)
    return { id: personId, name, email: personEmail }
  }
  const projectTasks = async (projectId = project.id): Promise<Json[]> =>
    (await session.call("GET", `/api/projects/${projectId}/tasks`)).body.tasks

  return {
    box,
    session,
    workspace,
    project,
    me,
    email,
    addProject,
    addTask,
    getTask,
    patchTask,
    addTag,
    tags,
    addField,
    addPerson,
    projectTasks,
  }
}

export type TaskWorld = Awaited<ReturnType<typeof taskWorld>>

export const keysOf = (rows: { key: string }[]) => rows.map((r) => r.key)
export const lines = (text: string) => text.split("\n").filter(Boolean)
