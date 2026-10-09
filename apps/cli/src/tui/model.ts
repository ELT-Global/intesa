// Pure board logic: what is shown, where cards go, how the table sorts. No I/O, no terminal.
import {
  compileSearch,
  type Placement,
  PRIORITY_RANK,
  placeTask,
  TASK_STATUSES,
  type TaskStatus,
} from "@intesa/task-query"
import type { Task } from "./api"

// The assignee filter's "nobody" entry, next to user ids.
export const UNASSIGNED = "unassigned"

export function matchesAssignees(task: Task, ids: readonly string[]) {
  if (ids.length === 0) return true
  return task.assignees.length === 0
    ? ids.includes(UNASSIGNED)
    : task.assignees.some((a) => ids.includes(a.id))
}

// The cards that pass the assignee filter and the search, in board order.
export function filterTasks(
  tasks: readonly Task[],
  opts: { assignees: readonly string[]; query: string; meId?: string },
) {
  const search = compileSearch(opts.query, { meId: opts.meId })
  return tasks.filter((t) => matchesAssignees(t, opts.assignees) && (!search || search(t)))
}

export const columnOf = (tasks: readonly Task[], status: TaskStatus) =>
  tasks.filter((t) => t.status === status && !t.parentTaskId)

export const nextStatus = (status: TaskStatus, delta: -1 | 1) =>
  TASK_STATUSES[TASK_STATUSES.indexOf(status) + delta]

/**
 * The views Shift+Arrow steps through, as for the web board: the current user, each other
 * member, Unassigned, then everyone (the empty selection).
 */
export function assigneeViews(meId: string | undefined, memberIds: readonly string[]) {
  const others = memberIds.filter((id) => id !== meId).map((id) => [id])
  return [...(meId ? [[meId]] : []), ...others, [UNASSIGNED], []]
}

export function stepAssigneeView(
  views: readonly string[][],
  current: readonly string[],
  delta: -1 | 1,
): string[] {
  const at = views.findIndex(
    (v) => v.length === current.length && v.every((id) => current.includes(id)),
  )
  const next =
    at === -1 ? (delta > 0 ? 0 : views.length - 1) : (at + delta + views.length) % views.length
  return views[next] ?? []
}

/** Who a new task starts assigned to: the one person filtered to, nobody for Unassigned, else me. */
export function newTaskAssignees(filter: readonly string[], meId: string | undefined): string[] {
  const [only] = filter
  if (filter.length === 1 && only) return only === UNASSIGNED ? [] : [only]
  return meId ? [meId] : []
}

export type Changes = Partial<
  Pick<Task, "title" | "body" | "status" | "priority" | "dueAt" | "assignees" | "tags">
>
// What an optimistic edit replaced: the changed fields and where the card sat.
export type Undo = { fields: Changes; index: number }

/**
 * The list with an edit applied as the server will apply it: a task changing column goes to
 * the top unless a placement says otherwise.
 */
export function applyChanges(
  list: readonly Task[],
  taskId: string,
  changes: Changes,
  placement?: Placement,
): { list: Task[]; undo?: Undo } {
  const index = list.findIndex((t) => t.id === taskId)
  const row = list[index]
  if (!row) return { list: [...list] }
  const fields = Object.fromEntries(
    Object.keys(changes).map((k) => [k, row[k as keyof Changes]]),
  ) as Changes
  const place =
    placement ??
    (changes.status !== undefined && changes.status !== row.status ? "first" : undefined)
  const edited = list.map((t) => (t.id === taskId ? { ...t, ...changes } : t))
  return { list: place ? placeTask(edited, taskId, place) : edited, undo: { fields, index } }
}

/** Puts back what `applyChanges` replaced, leaving other edits made since then alone. */
export function revert(list: readonly Task[], taskId: string, undo: Undo): Task[] {
  const current = list.find((t) => t.id === taskId)
  if (!current) return [...list]
  const others = list.filter((t) => t.id !== taskId)
  return [
    ...others.slice(0, undo.index),
    { ...current, ...undo.fields },
    ...others.slice(undo.index),
  ]
}

/** True when `placement` would leave `task` where it already is in its column. */
export function isInPlace(list: readonly Task[], task: Task, placement: Placement) {
  const column = columnOf(list, task.status)
  const at = column.findIndex((t) => t.id === task.id)
  if (placement === "first") return at === 0
  if (placement === "last") return at === column.length - 1
  if ("before" in placement) {
    return placement.before === task.id || column[at + 1]?.id === placement.before
  }
  return placement.after === task.id || column[at - 1]?.id === placement.after
}

export type SortKey = "task" | "status" | "priority" | "due"
export type Sort = { key: SortKey; dir: "asc" | "desc" }
export const SORT_KEYS: SortKey[] = ["task", "status", "priority", "due"]

/** As the web table: missing values always sort last, whichever direction is active. */
export function compareBy(sort: Sort): (a: Task, b: Task) => number {
  const sign = sort.dir === "asc" ? 1 : -1
  const value = (t: Task): string | number | null => {
    switch (sort.key) {
      case "task":
        return t.title.toLowerCase()
      case "status":
        return TASK_STATUSES.indexOf(t.status)
      case "priority":
        return t.priority ? PRIORITY_RANK[t.priority] : null
      case "due":
        return t.dueAt
    }
  }
  return (a, b) => {
    const x = value(a)
    const y = value(b)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return (x < y ? -1 : 1) * sign
  }
}

// Clicking a header again flips the direction, like the web table.
export const nextSort = (current: Sort | null, key: SortKey): Sort =>
  current?.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }

/**
 * A subsequence match for the pickers: lower is better, undefined is no match. Gaps between
 * matched letters cost, a match at the start is preferred.
 */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.toLowerCase().replace(/\s+/g, "")
  const t = text.toLowerCase()
  let from = 0
  let last = -1
  let score = 0
  for (const ch of q) {
    const at = t.indexOf(ch, from)
    if (at < 0) return undefined
    score += at - last - 1
    last = at
    from = at + 1
  }
  return t.startsWith(q) ? score - 1000 : score
}

export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string) {
  if (!query.trim()) return [...items]
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== undefined)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.item)
}

// "@alan" for Alan Owner, as on card lines elsewhere in the CLI.
export const handle = (name: string) => `@${(name.split(/\s+/)[0] ?? name).toLowerCase()}`
