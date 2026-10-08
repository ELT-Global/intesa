import { dueState, TASK_PRIORITIES, TASK_STATUSES, type TaskSummary } from "./tasks"

/**
 * Discord-style task search. A query is a list of space separated terms, all of which must match:
 *
 *   - `text`              free text, matched against the key, title and description
 *   - `"two words"`       free text containing spaces
 *   - `field:value`       a filter, e.g. `priority:medium`, `status:in_progress`, `assignee:me`
 *   - `field:a,b`         any of several values
 *   - `-field:value`      negated filter (`-text` negates free text)
 *
 * Unknown fields are searched as free text, and a filter with no value yet (`priority:`, typed
 * halfway) matches everything, so the list does not flicker while a term is being written.
 */

export const SEARCH_FIELDS = [
  { name: "status", hint: "Backlog, todo, in_progress, review, complete" },
  { name: "priority", hint: "Low, medium, high, urgent, none" },
  { name: "assignee", hint: "A person, me or unassigned" },
  { name: "tag", hint: "A tag name" },
  { name: "due", hint: "Overdue, soon, today, none or a date" },
  { name: "has", hint: "due, assignee, tag, priority, subtasks, description" },
  { name: "no", hint: "due, assignee, tag, priority, subtasks, description" },
] as const

export type SearchField = (typeof SEARCH_FIELDS)[number]["name"]

const FIELD_NAMES: ReadonlySet<string> = new Set(SEARCH_FIELDS.map((f) => f.name))
const HAS_VALUES = ["due", "assignee", "tag", "priority", "subtasks", "description"] as const
const DUE_VALUES = ["overdue", "soon", "today", "none"] as const

export type Term = {
  /** Where the term sits in the query string, quotes and any leading `-` included. */
  start: number
  end: number
  negated: boolean
  /** Set for `field:value` terms with a known field. */
  field?: SearchField
  /** The value or free text, lowercased and without quotes. */
  value: string
  /** The text after the colon (or the whole term) as typed, without quotes. */
  rawValue: string
  quoted: boolean
}

/** Splits a query into terms. Never throws: an unclosed quote runs to the end of the string. */
export function parseTerms(query: string): Term[] {
  const terms: Term[] = []
  let i = 0
  while (i < query.length) {
    if (/\s/.test(query[i] as string)) {
      i++
      continue
    }
    const start = i
    let text = ""
    let quoted = false
    let colon = -1
    while (i < query.length && !/\s/.test(query[i] as string)) {
      const ch = query[i] as string
      if (ch === '"') {
        quoted = true
        i++
        while (i < query.length && query[i] !== '"') text += query[i++]
        i++ // closing quote
        continue
      }
      if (ch === ":" && colon < 0 && !quoted) colon = text.length
      text += ch
      i++
    }
    const end = Math.min(i, query.length)
    const negated = text.startsWith("-") && text.length > 1
    const body = negated ? text.slice(1) : text
    const at = colon < 0 ? -1 : colon - (negated ? 1 : 0)
    const field = at > 0 ? body.slice(0, at).toLowerCase() : undefined
    if (field && FIELD_NAMES.has(field)) {
      const rawValue = body.slice(at + 1)
      terms.push({
        start,
        end,
        negated,
        field: field as SearchField,
        value: rawValue.toLowerCase(),
        rawValue,
        quoted,
      })
    } else {
      terms.push({ start, end, negated, value: body.toLowerCase(), rawValue: body, quoted })
    }
  }
  return terms
}

export type SearchContext = {
  /** Resolves `assignee:me`. */
  meId?: string
  now?: Date
}

const normalise = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "_")

function matchesValue(task: TaskSummary, field: SearchField, value: string, ctx: SearchContext) {
  switch (field) {
    case "status":
      return normalise(task.status).startsWith(normalise(value))
    case "priority":
      return value === "none" ? task.priority === null : task.priority?.startsWith(value) === true
    case "assignee":
      if (value === "unassigned" || value === "none") return task.assignees.length === 0
      if (value === "me") return !!ctx.meId && task.assignees.some((a) => a.id === ctx.meId)
      return task.assignees.some((a) => a.name.toLowerCase().includes(value))
    case "tag":
      return task.tags.some((t) => t.name.toLowerCase().includes(value))
    case "due":
      if (value === "none") return task.dueAt === null
      if (!task.dueAt) return false
      if (value === "overdue") return dueState(task.dueAt, task.status, ctx.now) === "overdue"
      if (value === "soon") return dueState(task.dueAt, task.status, ctx.now) === "soon"
      if (value === "today") return task.dueAt === localDay(ctx.now ?? new Date())
      return task.dueAt.startsWith(value)
    case "has":
    case "no":
      return hasProperty(task, value)
  }
}

function hasProperty(task: TaskSummary, what: string) {
  switch (what) {
    case "due":
      return task.dueAt !== null
    case "assignee":
      return task.assignees.length > 0
    case "tag":
      return task.tags.length > 0
    case "priority":
      return task.priority !== null
    case "subtasks":
      return task.subtaskCount > 0
    case "description":
      return !!task.body?.trim()
    default:
      // An unfinished or unknown property does not exclude anything.
      return true
  }
}

function localDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function matchesTerm(task: TaskSummary, term: Term, ctx: SearchContext): boolean {
  if (!term.field) {
    if (!term.value) return true
    return (
      task.key.toLowerCase().includes(term.value) ||
      task.title.toLowerCase().includes(term.value) ||
      (task.body?.toLowerCase().includes(term.value) ?? false)
    )
  }
  if (!term.value) return true
  const values = term.value.split(",").filter(Boolean)
  if (term.field === "no") {
    // `no:due` is the opposite of `has:due`; several values must all be missing.
    return values.every((v) => !hasProperty(task, v))
  }
  return values.some((v) => matchesValue(task, term.field as SearchField, v, ctx))
}

/** A predicate for the query, or `null` when it has nothing to filter by. */
export function compileSearch(
  query: string,
  ctx: SearchContext = {},
): ((task: TaskSummary) => boolean) | null {
  const terms = parseTerms(query).filter((t) => t.value !== "")
  if (terms.length === 0) return null
  return (task) => terms.every((t) => matchesTerm(task, t, ctx) !== t.negated)
}

export type Suggestion = {
  /** Shown in the list. */
  label: string
  /** Short explanation shown beside the label. */
  hint?: string
  /** What the term under the caret becomes. */
  insert: string
  /** True for a field name (`priority:`), after which the value is typed next. */
  partial: boolean
}

const MAX_SUGGESTIONS = 8

const distinctSorted = (names: Iterable<string>) => [...new Set(names)].sort()
const quoteIfNeeded = (v: string) => (/\s/.test(v) ? `"${v}"` : v)

function valueCandidates(field: SearchField, tasks: readonly TaskSummary[]): string[] {
  switch (field) {
    case "status":
      return [...TASK_STATUSES]
    case "priority":
      return [...TASK_PRIORITIES, "none"]
    case "due":
      return [...DUE_VALUES]
    case "has":
    case "no":
      return [...HAS_VALUES]
    case "assignee":
      return [
        "me",
        "unassigned",
        ...distinctSorted(tasks.flatMap((t) => t.assignees.map((a) => a.name))),
      ]
    case "tag":
      return distinctSorted(tasks.flatMap((t) => t.tags.map((g) => g.name)))
  }
}

/**
 * What to offer for the term under `caret`: field names while a term has no colon yet, then the
 * values that field can take (people and tags come from `tasks`). Empty when nothing fits.
 */
export function suggest(
  query: string,
  caret: number,
  tasks: readonly TaskSummary[],
): { suggestions: Suggestion[]; start: number; end: number } {
  const none = { suggestions: [], start: caret, end: caret }
  const term = parseTerms(query).find((t) => caret >= t.start && caret <= t.end)
  const start = term?.start ?? caret
  const end = term?.end ?? caret
  const dash = term?.negated ? "-" : ""
  // Between terms, the list of fields is only offered on an empty query: after a finished term
  // it would just cover the results.
  if (!term && query.trim() !== "") return none

  if (!term || (!term.field && !term.rawValue.includes(":"))) {
    const typed = (term?.rawValue ?? "").toLowerCase()
    if (term?.quoted) return none
    const suggestions = SEARCH_FIELDS.filter((f) => f.name.startsWith(typed))
      // The exact name is already complete; offering it again only gets in the way.
      .filter((f) => f.name !== typed)
      .map((f) => ({
        label: `${f.name}:`,
        hint: f.hint,
        insert: `${dash}${f.name}:`,
        partial: true,
      }))
    return { suggestions: suggestions.slice(0, MAX_SUGGESTIONS), start, end }
  }
  if (!term.field) return none

  // Only the value after the last comma is being completed.
  const comma = term.rawValue.lastIndexOf(",")
  const done = comma < 0 ? "" : term.rawValue.slice(0, comma + 1)
  const typing = term.rawValue.slice(comma + 1).toLowerCase()
  const already = new Set(done.split(",").map((v) => v.toLowerCase()))
  const suggestions = valueCandidates(term.field, tasks)
    // Matches the start of the value or of a later word, so "owner" finds "Olive Owner".
    .filter((v) => v.toLowerCase().startsWith(typing) || v.toLowerCase().includes(` ${typing}`))
    .filter((v) => v.toLowerCase() !== typing && !already.has(v.toLowerCase()))
    .map((v) => ({
      label: v,
      insert: `${dash}${term.field}:${quoteIfNeeded(done + v)}`,
      partial: false,
    }))
  return { suggestions: suggestions.slice(0, MAX_SUGGESTIONS), start, end }
}

/** Replaces the range `[start, end)` of `query` with a suggestion, ready for the next term. */
export function applySuggestion(
  query: string,
  range: { start: number; end: number },
  s: Suggestion,
): { query: string; caret: number } {
  const before = query.slice(0, range.start)
  const after = query.slice(range.end).replace(/^\s+/, "")
  const space = s.partial ? "" : " "
  const next = `${before}${s.insert}${space}${after}`
  return { query: next, caret: before.length + s.insert.length + space.length }
}
