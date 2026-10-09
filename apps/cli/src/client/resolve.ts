import { PROJECT_KEY_PATTERN, TASK_KEY_PATTERN } from "@intesa/api/schemas"
import { cacheWorkspace, readHosts } from "../config/config"
import { notFound, usageError } from "../output/errors"
import type { Ctx } from "../registry/define"
import { requireHost } from "./context"


// Turns what people type (slugs, keys, names, links) into API objects. Lists are fetched
// lazily and at most once per invocation; nothing but a workspace's id is kept on disk, so
// the CLI never works from stale data.

type Deps = Pick<Ctx, "http" | "context" | "configDir">
export type WorkspaceRef = { id: string; slug: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Exact id first, then (with `exactCase`) a name as typed, then a case-insensitive name (or
// email). The first step that finds anything decides; several matches in it are never
// guessed between. None is NOT_FOUND, like an unknown id on the server.
export function pickOne<T>(
  items: T[],
  query: string,
  opts: {
    noun: string
    ids: (t: T) => string[]
    names: (t: T) => string[]
    label: (t: T) => string
    exactCase?: boolean
    // For NOT_FOUND, e.g. what there is to choose from.
    hint?: string
  },
): T {
  const wanted = query.toLowerCase()
  const steps = [
    (t: T) => opts.ids(t).includes(query),
    ...(opts.exactCase ? [(t: T) => opts.names(t).includes(query)] : []),
    (t: T) => opts.names(t).some((n) => n.toLowerCase() === wanted),
  ]
  for (const step of steps) {
    const matches = items.filter(step)
    const [first] = matches
    if (matches.length === 1 && first !== undefined) return first
    if (matches.length > 1) {
      throw usageError(
        `"${query}" matches several ${opts.noun}s: ${matches.map(opts.label).join(", ")}`,
        `Name one of them exactly, e.g. by ${opts.noun === "member" ? "email" : "id"}.`,
      )
    }
  }
  throw notFound(`no ${opts.noun} matches "${query}"`, opts.hint)
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined
  return () => {
    value ??= load()
    return value
  }
}

// A task link from the web app: …/projects/<id>?task=<uuid>.
function taskIdFromLink(ref: string): string | undefined {
  if (!/^https?:\/\//i.test(ref)) return undefined
  let url: URL
  try {
    url = new URL(ref)
  } catch {
    throw usageError(`invalid task link "${ref}"`)
  }
  const id = url.searchParams.get("task")
  if (!id) throw usageError(`the link "${ref}" does not point at a task (no ?task=)`)
  return id
}

const resolvers = new WeakMap<Deps, ReturnType<typeof createResolver>>()

// One resolver per invocation (per ctx), so every command shares the fetched lists.
export function resolver(ctx: Deps) {
  let r = resolvers.get(ctx)
  if (!r) {
    r = createResolver(ctx)
    resolvers.set(ctx, r)
  }
  return r
}

function createResolver(ctx: Deps) {
  const client = async () => (await ctx.http()).client
  const host = () => requireHost(ctx.context())

  const me = once(async () => (await (await (await client()).api.me.$get()).json()).user)

  const workspaces = once(
    async () => (await (await (await client()).api.workspaces.$get()).json()).workspaces,
  )

  const remember = (ws: WorkspaceRef) => cacheWorkspace(ctx.configDir, host(), ws)

  // A slug (any case) or an id.
  async function findWorkspace(wanted: string): Promise<WorkspaceRef> {
    const cached = readHosts(ctx.configDir)[host()]?.workspace
    if (cached && (cached.slug === wanted || cached.id === wanted)) return cached
    const list = await workspaces()
    const found = list.find((w) => w.slug === wanted.toLowerCase() || w.id === wanted)
    if (!found) {
      throw notFound(
        `no workspace "${wanted}"`,
        list.length ? `Your workspaces: ${list.map((w) => w.slug).join(", ")}.` : undefined,
      )
    }
    remember(found)
    return found
  }

  // -w, INTESA_WORKSPACE, .intesa.json, the config default, else the user's only workspace.
  const currentWorkspace = once(async (): Promise<WorkspaceRef> => {
    const wanted = ctx.context().workspace?.value
    if (wanted) return findWorkspace(wanted)
    const list = await workspaces()
    const [only] = list
    if (list.length === 1 && only) {
      remember(only)
      return only
    }
    if (list.length === 0) {
      throw usageError(
        "you are not a member of any workspace",
        "Create one with `intesa workspace create NAME`.",
      )
    }
    throw usageError(
      `you belong to several workspaces (${list.map((w) => w.slug).join(", ")}): pass -w/--workspace, set INTESA_WORKSPACE, or add one to .intesa.json`,
      "Run `intesa workspace use SLUG` to set a default.",
    )
  })

  const workspace = (ref?: string) => (ref ? findWorkspace(ref) : currentWorkspace())

  const projects = once(async () => {
    const { id } = await currentWorkspace()
    const res = await (await client()).api.workspaces[":workspaceId"].projects.$get({
      param: { workspaceId: id },
    })
    return (await res.json()).projects
  })

  // A KEY (any case) or id; without one, -p / INTESA_PROJECT / .intesa.json / config.
  async function project(ref?: string) {
    const wanted = ref ?? ctx.context().project?.value
    if (!wanted) {
      throw usageError(
        "no project: name one, pass -p/--project, set INTESA_PROJECT, or add one to .intesa.json",
        "Run `intesa project use KEY` to set a default.",
      )
    }
    const list = await projects()
    const found =
      list.find((p) => p.id === wanted) ?? list.find((p) => p.key === wanted.toUpperCase())
    if (!found) {
      const { slug } = await currentWorkspace()
      throw notFound(`no project with key "${wanted}" in workspace ${slug}`)
    }
    return found
  }

  // WEB-12 (any case, subtasks too), 12 with a project context, a task id or a web link.
  async function task(ref: string) {
    const id = UUID.test(ref) ? ref : taskIdFromLink(ref)
    if (id) {
      const res = await (await client()).api.tasks[":taskId"].$get({ param: { taskId: id } })
      return (await res.json()).task
    }
    let key = ref
    if (/^\d+$/.test(ref)) {
      const context = ctx.context().project?.value
      if (!context) {
        throw usageError(
          `task number ${ref} needs a project: pass -p/--project, or use the full key like WEB-${ref}`,
        )
      }
      // A key from context saves listing the projects just to learn it.
      const projectKey = PROJECT_KEY_PATTERN.test(context.toUpperCase())
        ? context.toUpperCase()
        : (await project()).key
      key = `${projectKey}-${ref}`
    }
    if (!TASK_KEY_PATTERN.test(key)) {
      throw usageError(
        `invalid task "${ref}": use a key like WEB-12, a number with -p, a task id or a task link`,
      )
    }
    const { id: workspaceId } = await currentWorkspace()
    const res = await (await client()).api.workspaces[":workspaceId"].tasks["by-key"][":key"].$get({
      param: { workspaceId, key: key.toUpperCase() },
    })
    return (await res.json()).task
  }

  const members = once(async () => {
    const { id } = await currentWorkspace()
    const res = await (await client()).api.workspaces[":workspaceId"].members.$get({
      param: { workspaceId: id },
    })
    return (await res.json()).members
  })

  async function member(query: string) {
    const list = await members()
    if (query === "@me") {
      const user = await me()
      const found = list.find((m) => m.userId === user.id)
      if (!found) throw notFound("you are not a member of this workspace")
      return found
    }
    return pickOne(list, query, {
      noun: "member",
      ids: (m) => [m.id, m.userId],
      names: (m) => [m.name, m.email],
      label: (m) => `${m.name} <${m.email}>`,
    })
  }

  const tags = once(async () => {
    const { id } = await currentWorkspace()
    const res = await (await client()).api.workspaces[":workspaceId"].tags.$get({
      param: { workspaceId: id },
    })
    return (await res.json()).tags
  })

  const tag = async (query: string) =>
    pickOne(await tags(), query, {
      noun: "tag",
      ids: (t) => [t.id],
      names: (t) => [t.name],
      label: (t) => `${t.name} (${t.id})`,
    })

  const fieldLists = new Map<string, ReturnType<typeof loadFields>>()
  const loadFields = async (projectId: string) => {
    const res = await (await client()).api.projects[":projectId"]["custom-fields"].$get({
      param: { projectId },
    })
    return (await res.json()).fields
  }
  const fields = (projectId: string) => {
    let list = fieldLists.get(projectId)
    if (!list) {
      list = loadFields(projectId)
      fieldLists.set(projectId, list)
    }
    return list
  }

  const field = async (projectId: string, query: string) =>
    pickOne(await fields(projectId), query, {
      noun: "custom field",
      ids: (f) => [f.id],
      names: (f) => [f.name],
      label: (f) => `${f.name} (${f.id})`,
    })

  return {
    me,
    workspaces,
    workspace,
    projects,
    project,
    task,
    members,
    member,
    tags,
    tag,
    fields,
    field,
  }
}

export type Resolver = ReturnType<typeof resolver>
