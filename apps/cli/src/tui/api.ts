// Everything the board takes from the rest of the CLI goes through this file, so the TUI
// depends on a handful of names: resolution, the typed client, links, the editor and browser.
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename } from "node:path"
import { artifactFileError } from "@intesa/api/artifacts"
import { type PatchTaskInput, TASK_KEY_PATTERN } from "@intesa/api/schemas"
import { sendArtifact } from "../client/artifacts"
import { links } from "../client/links"
import { type Resolver, resolver } from "../client/resolve"
import { plural } from "../commands/task/shared"
import { openBrowser } from "../io/browser"
import { editText } from "../io/editor"
import { CliError } from "../output/errors"
import { dueText, glyphs, handle, supportsUnicode } from "../output/task-line"
import type { Ctx } from "../registry/define"
import { expandPath, splitPaths } from "./model"

export type { Ctx }
export { CliError, dueText, glyphs, handle, plural }

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
  parentTaskId?: string
}
// A file on this machine, checked for upload.
export type LocalFile = { path: string; name: string }

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
  // The files typed for upload, or why one of them cannot be.
  localFiles: (input: string) => LocalFile[] | string
  uploadArtifact: (taskId: string, file: LocalFile) => Promise<Artifact>
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

/**
 * The files typed for upload, relative to `cwd`, each checked as the server would check it
 * without its content; else, in the server's words, why one cannot be sent.
 */
export function localFiles(input: string, cwd: string, home: string): LocalFile[] | string {
  const whole = input.trim()
  // An unquoted path with spaces in it, as typed or pasted, names one file.
  const typed = existsSync(expandPath(whole, cwd, home)) ? [whole] : splitPaths(input)
  const files: LocalFile[] = []
  for (const each of typed) {
    const path = expandPath(each, cwd, home)
    let size: number
    try {
      const stat = statSync(path)
      if (!stat.isFile()) return `${each}: not a file`
      size = stat.size
    } catch {
      return `${each}: no such file`
    }
    const name = basename(path)
    const problem = artifactFileError({ name, type: "", size })
    if (problem) return `${name}: ${problem}`
    files.push({ path, name })
  }
  return files.length > 0 ? files : "Type the path of a file"
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isTaskRef = (ref: string) =>
  TASK_KEY_PATTERN.test(ref) || UUID.test(ref) || /^https?:\/\//i.test(ref)

// Resolves where the board starts (before the screen is taken over, so errors print as usual,
// with --debug logging as usual) and wraps the typed client.
export async function connect(ctx: Ctx, ref?: string): Promise<{ api: BoardApi; start: Start }> {
  const r = resolver(ctx)
  // Quiet: --debug and INTESA_DEBUG would write over the full-screen board, and the board
  // asks again for who I am once it is up.
  const http = await ctx.http({ quiet: true })
  const onBoard = resolver({ ...ctx, http: () => ctx.http({ quiet: true }) })
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
    me: () => onBoard.me(),
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
      await sendArtifact(http, "PUT", artifactUrl(taskId, artifact.id), artifact.name, text)
    },
    localFiles: (input) => localFiles(input, ctx.cwd, homedir()),
    uploadArtifact: async (taskId, file) =>
      sendArtifact(
        http,
        "POST",
        links.artifact(http.host, taskId),
        file.name,
        await Bun.file(file.path).bytes(),
      ),
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
