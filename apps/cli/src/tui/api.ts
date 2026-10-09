// Everything the board takes from the rest of the CLI goes through this file, so the TUI
// depends on a handful of names: resolution, the typed client, links, the editor and browser.
import { type PatchTaskInput, TASK_KEY_PATTERN } from "@intesa/api/schemas"
import { requireHost } from "../client/context"
import { createHttp, debugLevel, type Http, timeoutMs } from "../client/http"
import { links } from "../client/links"
import { type Resolver, resolver } from "../client/resolve"
import { plural } from "../commands/task/shared"
import { readToken } from "../config/secrets"
import { openBrowser } from "../io/browser"
import { editText } from "../io/editor"
import { CliError } from "../output/errors"
import { dueText, glyphs, supportsUnicode } from "../output/task-line"
import type { Ctx } from "../registry/define"

export type { Ctx }
export { CliError, dueText, glyphs, plural }

export type TaskDetail = Awaited<ReturnType<Resolver["task"]>>
export type Task = TaskDetail["subtasks"][number]
export type Person = Task["assignees"][number]
export type Me = Awaited<ReturnType<Resolver["me"]>>
export type Member = Awaited<ReturnType<Resolver["members"]>>[number]
export type Project = Awaited<ReturnType<Resolver["projects"]>>[number]
export type Workspace = { id: string; slug: string }
export type Field = Awaited<ReturnType<Resolver["fields"]>>[number]
export type TaskPatch = PatchTaskInput
export type Artifact = { id: string; name: string; mimeType: string; size: number }
export type History = {
  id: string
  fromStatus: Task["status"] | null
  toStatus: Task["status"]
  updatedAt: string
  updatedBy: { name: string }
}
export type NewTask = {
  title: string
  status: Task["status"]
  assigneeIds?: string[]
}

export type BoardApi = {
  me: () => Promise<Me>
  workspaces: () => Promise<Workspace[]>
  projects: (workspaceId: string) => Promise<Project[]>
  members: (workspaceId: string) => Promise<Member[]>
  fields: (projectId: string) => Promise<Field[]>
  tasks: (projectId: string) => Promise<Task[]>
  task: (taskId: string) => Promise<TaskDetail>
  artifacts: (taskId: string) => Promise<Artifact[]>
  history: (taskId: string) => Promise<History[]>
  create: (projectId: string, input: NewTask) => Promise<Task>
  update: (taskId: string, patch: TaskPatch) => Promise<Task>
  remove: (taskId: string) => Promise<void>
  taskUrl: (workspaceSlug: string, task: { id: string; projectId: string }) => string
  artifactUrl: (taskId: string, artifactId: string) => string
  artifactText: (taskId: string, artifactId: string) => Promise<string>
  saveArtifact: (taskId: string, artifact: Artifact, text: string) => Promise<void>
  openUrl: (url: string) => boolean
  // Opens `text` in the user's editor and resolves with what was saved.
  edit: (text: string, filename: string) => Promise<string>
}

export type Start = {
  workspace: Workspace
  project?: Project
  // A task to open once the board has loaded (from `intesa board WEB-12`).
  openTask?: string
  unicode: boolean
  color: boolean
}

// What a failed request says to a person: the server's words for a 4xx (written for users),
// nothing for server and network failures, whose text is not meant for them.
export function reasonOf(err: unknown): string | undefined {
  const e = err as { exitCode?: number; message?: string }
  return e.exitCode !== undefined && e.exitCode !== 1 ? e.message : undefined
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isTaskRef = (ref: string) =>
  TASK_KEY_PATTERN.test(ref) || UUID.test(ref) || /^https?:\/\//i.test(ref)

// A client like the CLI's that never logs: on the full-screen board, --debug and INTESA_DEBUG
// would write over the board.
async function quietHttp(ctx: Ctx): Promise<Http> {
  if (debugLevel(ctx.env, ctx.globals.debug) === "off") return ctx.http()
  const host = requireHost(ctx.context())
  const credentials = await readToken(ctx.configDir, host, ctx.env)
  return createHttp({
    host,
    token: credentials?.token,
    dryRun: false,
    debug: "off",
    stdout: () => {},
    stderr: () => {},
    timeoutMs: timeoutMs(ctx.env),
  })
}

// Resolves where the board starts (before the screen is taken over, so errors print as usual,
// with --debug logging as usual) and wraps the typed client.
export async function connect(ctx: Ctx, ref?: string): Promise<{ api: BoardApi; start: Start }> {
  const r = resolver(ctx)
  const http = await quietHttp(ctx)
  const { client } = http
  const workspace = await r.workspace()

  let project: Project | undefined
  let openTask: string | undefined
  if (ref && isTaskRef(ref)) {
    const task = await r.task(ref)
    project = (await r.projects()).find((p) => p.id === task.projectId)
    openTask = task.id
  } else if (ref || ctx.context().project) {
    project = await r.project(ref)
  }

  const artifactUrl = (taskId: string, artifactId: string) =>
    links.artifact(http.host, taskId, artifactId)

  const api: BoardApi = {
    me: () => r.me(),
    // Not the resolver's: it keeps its first answer, and W should list workspaces made since.
    workspaces: async () => (await (await client.api.workspaces.$get()).json()).workspaces,
    projects: async (workspaceId) =>
      (
        await (
          await client.api.workspaces[":workspaceId"].projects.$get({ param: { workspaceId } })
        ).json()
      ).projects,
    members: async (workspaceId) =>
      (
        await (
          await client.api.workspaces[":workspaceId"].members.$get({ param: { workspaceId } })
        ).json()
      ).members,
    fields: async (projectId) =>
      (
        await (
          await client.api.projects[":projectId"]["custom-fields"].$get({ param: { projectId } })
        ).json()
      ).fields,
    tasks: async (projectId) =>
      (await (await client.api.projects[":projectId"].tasks.$get({ param: { projectId } })).json())
        .tasks,
    task: async (taskId) =>
      (await (await client.api.tasks[":taskId"].$get({ param: { taskId } })).json()).task,
    artifacts: async (taskId) =>
      (await (await client.api.tasks[":taskId"].artifacts.$get({ param: { taskId } })).json())
        .artifacts,
    history: async (taskId) =>
      (await (await client.api.tasks[":taskId"].history.$get({ param: { taskId } })).json())
        .history,
    create: async (projectId, input) =>
      (
        await (
          await client.api.projects[":projectId"].tasks.$post({ param: { projectId }, json: input })
        ).json()
      ).task,
    update: async (taskId, patch) =>
      (await (await client.api.tasks[":taskId"].$patch({ param: { taskId }, json: patch })).json())
        .task,
    remove: async (taskId) => {
      await client.api.tasks[":taskId"].$delete({ param: { taskId } })
    },
    taskUrl: (slug, task) => links.task(http.host, slug, task),
    artifactUrl,
    artifactText: async (taskId, artifactId) =>
      (await http.request(artifactUrl(taskId, artifactId))).text(),
    saveArtifact: async (taskId, artifact, text) => {
      const body = new FormData()
      body.set("file", new File([text], artifact.name))
      await http.request(artifactUrl(taskId, artifact.id), { method: "PUT", body })
    },
    openUrl: (url) => openBrowser(url, { env: ctx.env, configBrowser: ctx.config.browser }),
    edit: (text, filename) =>
      editText(text, {
        filename,
        env: ctx.env,
        configEditor: ctx.config.editor,
        interactive: true,
      }),
  }
  return {
    api,
    start: {
      workspace: { id: workspace.id, slug: workspace.slug },
      project,
      openTask,
      unicode: supportsUnicode(ctx.env),
      color: ctx.mode.color,
    },
  }
}
