import { isRealDate } from "@intesa/api/schemas"
import { links, type Resolver, resolver } from "../../client/resolve"
import { CliError, usageError } from "../../output/errors"
import { formatTaskLines, type LineStyle, supportsUnicode } from "../../output/task-line"
import type { Arg, Ctx } from "../../registry/define"

export type TaskDetail = Awaited<ReturnType<Resolver["task"]>>
export type TaskSummary = TaskDetail["subtasks"][number]
type FieldDef = Awaited<ReturnType<Resolver["fields"]>>[number]

export const lineStyle = (ctx: Ctx): LineStyle => ({
  color: ctx.mode.color,
  unicode: supportsUnicode(ctx.env),
  width: ctx.mode.width,
})

// Adds the web link that "Copy link" gives for each task.
export async function linker(ctx: Ctx) {
  const [{ host }, { slug }] = await Promise.all([ctx.http(), resolver(ctx).workspace()])
  return <T extends { id: string; projectId: string }>(task: T) => ({
    ...task,
    url: links.task(host, slug, task),
  })
}

type Shown = TaskSummary & { url: string }

// JSON and -q get the tasks as they are; a terminal gets card lines; piped output gets TSV
// rows with people and tags as plain names.
export function present<T extends Shown>(ctx: Ctx, data: T | T[]) {
  const { json, quiet, fields } = ctx.globals
  if (json || quiet) return data
  const list = Array.isArray(data) ? data : [data]
  if (ctx.mode.tty && !fields) {
    if (list.length === 0) ctx.stderr("No tasks found.\n")
    ctx.stdout(formatTaskLines(list, lineStyle(ctx)))
    return
  }
  return list.map((t) => ({
    ...t,
    assignees: t.assignees.map((a) => a.name),
    tags: t.tags.map((g) => g.name),
  }))
}

// Task keys of the current project (or the -p typed on the command line), for completion.
export async function taskKeys(ctx: Ctx, { word, words }: { word: string; words: string[] }) {
  const at = words.findLastIndex((w) => w === "-p" || w === "--project")
  const typed =
    (at >= 0 ? words[at + 1] : undefined) ??
    words.findLast((w) => w.startsWith("--project="))?.slice("--project=".length)
  const project = await resolver(ctx).project(typed)
  const { client } = await ctx.http()
  const res = await client.api.projects[":projectId"].tasks.$get({
    param: { projectId: project.id },
  })
  return (await res.json()).tasks
    .sort((a, b) => a.number - b.number)
    .map((t) => t.key)
    .filter((k) => k.startsWith(word.toUpperCase()))
}

export const taskArg = {
  name: "task",
  required: true,
  description: "Task key like WEB-12, a number with -p, a task id or a task link",
  complete: taskKeys,
} as const satisfies Arg

// `-a @me,Mei -a una@example.com`: repeated flags and comma lists alike.
export const splitList = (values: readonly string[] | undefined) =>
  (values ?? [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean)

// People by email, name, id or @me ("me" works too, as in the search syntax).
export async function userIds(ctx: Ctx, refs: string[]) {
  const r = resolver(ctx)
  const ids: string[] = []
  for (const ref of refs) ids.push((await r.member(ref === "me" ? "@me" : ref)).userId)
  return ids
}

// Tags by name or id. Unknown names are created when `create` is set, after every other
// name has resolved, so a typo elsewhere does not leave new tags behind.
export async function tagIds(ctx: Ctx, refs: string[], create = false) {
  const r = resolver(ctx)
  const found: (string | undefined)[] = []
  for (const ref of refs) {
    try {
      found.push((await r.tag(ref)).id)
    } catch (err) {
      if (!(err instanceof CliError) || err.exitCode !== 5) throw err
      if (!create) {
        throw new CliError(err.message, {
          code: err.code,
          exitCode: 5,
          hint: "Pass --create-tags to create missing tags.",
        })
      }
      found.push(undefined)
    }
  }
  if (found.every((id) => id !== undefined)) return found as string[]
  const { client } = await ctx.http()
  const { id: workspaceId } = await r.workspace()
  const ids: string[] = []
  for (const [i, ref] of refs.entries()) {
    const known = found[i]
    if (known) {
      ids.push(known)
      continue
    }
    const res = await client.api.workspaces[":workspaceId"].tags.$post({
      param: { workspaceId },
      json: { name: ref },
    })
    const { tag } = await res.json()
    ctx.stderr(`Created tag ${tag.name}\n`)
    ids.push(tag.id)
  }
  return ids
}

export function dueDate<T extends string | null | undefined>(value: T): T {
  if (typeof value === "string" && !isRealDate(value)) {
    throw usageError(`invalid value "${value}" for --due: expected a date as YYYY-MM-DD`)
  }
  return value
}

// -b TEXT or -F FILE (- for stdin).
export async function readBody(ctx: Ctx, flags: { body?: string; bodyFile?: string }) {
  if (flags.body !== undefined && flags.bodyFile !== undefined) {
    throw usageError("--body and --body-file conflict: pass one")
  }
  if (flags.bodyFile === undefined) return flags.body
  if (flags.bodyFile === "-") return ctx.readStdin()
  const file = Bun.file(flags.bodyFile)
  if (!(await file.exists())) throw usageError(`--body-file: no such file "${flags.bodyFile}"`)
  return file.text()
}

// A typed value from the command line, checked here so a mistake fails before any write.
function fieldValue(field: FieldDef, raw: string): unknown {
  const bad = (expected: string) =>
    usageError(`invalid value "${raw}" for field ${field.name}: expected ${expected}`)
  switch (field.type) {
    case "number": {
      const n = Number(raw)
      if (raw.trim() === "" || !Number.isFinite(n)) throw bad("a number")
      return n
    }
    case "boolean": {
      const v = raw.toLowerCase()
      if (["true", "yes", "1"].includes(v)) return true
      if (["false", "no", "0"].includes(v)) return false
      throw bad("true or false")
    }
    case "date":
      if (!isRealDate(raw)) throw bad("a date as YYYY-MM-DD")
      return raw
    case "select": {
      const option =
        field.options.find((o) => o === raw) ??
        field.options.find((o) => o.toLowerCase() === raw.toLowerCase())
      if (option === undefined) throw bad(`one of ${field.options.join(", ")}`)
      return option
    }
    default:
      return raw
  }
}

// `--field NAME=VALUE` and `--clear-field NAME` as the API's customFields patch (by field id).
export async function customFields(
  ctx: Ctx,
  projectId: string,
  set: readonly string[],
  clear: readonly string[] = [],
) {
  const pairs = set.map((entry) => {
    const at = entry.indexOf("=")
    if (at <= 0) throw usageError(`--field expects NAME=VALUE, got "${entry}"`)
    return [entry.slice(0, at), entry.slice(at + 1)] as const
  })
  const r = resolver(ctx)
  const values: Record<string, unknown> = {}
  for (const [name, raw] of pairs) {
    const field = await r.field(projectId, name)
    values[field.id] = fieldValue(field, raw)
  }
  for (const name of clear) values[(await r.field(projectId, name)).id] = null
  return values
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
