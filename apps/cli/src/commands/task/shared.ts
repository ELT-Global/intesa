import { isRealDate } from "@intesa/api/schemas"
import { relativeTime, STATUS_LABELS } from "@intesa/task-query"
import { z } from "zod"
import { signoffPeople, taskKeys } from "../../client/candidates"
import { type Resolver, resolver } from "../../client/resolve"
import { readInput, splitPair } from "../../io/input"
import { CliError, usageError } from "../../output/errors"
import { asTable, rows } from "../../output/render"
import { formatTaskLines, glyphs, type LineStyle, supportsUnicode } from "../../output/task-line"
import type { Arg, Ctx } from "../../registry/define"

export type TaskDetail = Awaited<ReturnType<Resolver["task"]>>
export type TaskSummary = TaskDetail["subtasks"][number]
type FieldDef = Awaited<ReturnType<Resolver["fields"]>>[number]

export const lineStyle = (ctx: Ctx): LineStyle => ({
  color: ctx.mode.color,
  unicode: supportsUnicode(ctx.env),
  width: ctx.mode.width,
})

// How tasks read: a terminal gets card lines, piped output a TSV row per task.
export function showTasks(ctx: Ctx, data: TaskSummary | TaskSummary[]) {
  const list = Array.isArray(data) ? data : [data]
  if (!ctx.mode.tty) return asTable(ctx.mode, list, "task")
  if (list.length === 0) ctx.stderr("No tasks found.\n")
  return formatTaskLines(list, lineStyle(ctx))
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

// Who reviewed or tested a task, as the API's reviewedById / testedById: a person as for
// --assignee, `none` for nobody (null), and undefined when not given (left as it is).
export async function signoffId(ctx: Ctx, ref: string | undefined) {
  if (ref === undefined) return undefined
  if (ref.trim().toLowerCase() === "none") return null
  return (await userIds(ctx, [ref.trim()]))[0]
}

// The flags of task create, edit and move that answer who reviewed and who tested a task.
export const signoffFlags = {
  reviewedBy: z.string().optional().meta({
    placeholder: "person",
    description: "Who reviewed it: @me, an email or a name; none for nobody",
    complete: signoffPeople,
  }),
  testedBy: z.string().optional().meta({
    placeholder: "person",
    description: "Who tested it: @me, an email or a name; none for nobody",
    complete: signoffPeople,
  }),
}

// Tags by name or id. With `create` set, unknown names are created, after every other name
// has resolved, so a typo elsewhere does not leave new tags behind; with it unset (false)
// the error says how to create them.
export async function tagIds(ctx: Ctx, refs: string[], create?: boolean) {
  const r = resolver(ctx)
  const found: (string | undefined)[] = []
  for (const ref of refs) {
    try {
      found.push((await r.tag(ref)).id)
    } catch (err) {
      if (!(err instanceof CliError) || err.exitCode !== 5 || create === undefined) throw err
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
  return readInput(ctx, flags.bodyFile, "--body-file")
}

// A typed value from the command line, checked here so a mistake fails before any write.
export function fieldValue(field: FieldDef, raw: string): unknown {
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

// `--field NAME=VALUE` and `--clear-field NAME` as the API's customFields (by field id).
export async function customFields(
  ctx: Ctx,
  projectId: string,
  set: readonly string[],
  clear: readonly string[] = [],
) {
  const pairs = set.map((entry) => splitPair(entry, "--field"))
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

// A task's relationships as rows: kind, key, title, status.
export function relationRows(ctx: Ctx, task: Pick<TaskDetail, "blocks" | "blockedBy" | "related">) {
  const relations = (
    [
      ["Blocks", task.blocks],
      ["Blocked by", task.blockedBy],
      ["Related", task.related],
    ] as const
  ).flatMap(([kind, refs]) =>
    refs.map((t) => ({ kind, key: t.key, title: t.title, status: STATUS_LABELS[t.status] })),
  )
  return relations.length > 0 ? rows(ctx.mode, relations, ["kind", "key", "title", "status"]) : ""
}

export type HistoryEntry = {
  fromStatus: TaskDetail["status"] | null
  toStatus: TaskDetail["status"]
  updatedAt: string
  updatedBy: { name: string }
}

// Status changes as rows: when, who, from → to. Relative dates on a terminal, ISO when piped.
export function historyRows(ctx: Ctx, history: HistoryEntry[]) {
  const tty = ctx.mode.tty
  const arrow = tty ? glyphs(lineStyle(ctx)).arrow : "->"
  const changes = history.map((h) => ({
    at: tty ? relativeTime(h.updatedAt) : h.updatedAt,
    by: h.updatedBy.name,
    change: `${h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} ${arrow} ` : ""}${STATUS_LABELS[h.toStatus]}`,
  }))
  return rows(ctx.mode, changes, ["at", "by", "change"])
}
