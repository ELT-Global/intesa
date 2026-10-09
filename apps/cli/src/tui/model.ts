// Pure board logic of the terminal board alone; the rules it shares with the web board (the
// assignee filter, placement, the table sort) come from @intesa/task-query.

import { join, resolve } from "node:path"
import {
  compileSearch,
  matchesAssignees,
  type Placement,
  placeTask,
  TASK_STATUSES,
  type TaskStatus,
} from "@intesa/task-query"
import type { Task } from "./api"

// The cards that pass the assignee filter and the search, in board order.
export function filterTasks(
  tasks: readonly Task[],
  opts: { assignees: readonly string[]; query: string; meId?: string },
) {
  const search = compileSearch(opts.query, { meId: opts.meId })
  return tasks.filter((t) => matchesAssignees(t, opts.assignees) && (!search || search(t)))
}

export const nextStatus = (status: TaskStatus, delta: -1 | 1) =>
  TASK_STATUSES[TASK_STATUSES.indexOf(status) + delta]

export type Changes = Partial<
  Pick<Task, "title" | "body" | "status" | "priority" | "dueAt" | "assignees" | "tags">
>
// What an optimistic edit replaced: the changed fields and, when it moved, where the card sat.
export type Undo = { fields: Changes; index?: number }

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
  if (!place) return { list: edited, undo: { fields } }
  return { list: placeTask(edited, taskId, place), undo: { fields, index } }
}

/**
 * Puts back what `applyChanges` replaced, leaving other edits made since then alone. The card
 * goes back to its old place only if the edit moved it, as on the web.
 */
export function revert(list: readonly Task[], taskId: string, undo: Undo): Task[] {
  const current = list.find((t) => t.id === taskId)
  if (!current) return [...list]
  const restored = { ...current, ...undo.fields }
  if (undo.index === undefined) return list.map((t) => (t.id === taskId ? restored : t))
  const others = list.filter((t) => t.id !== taskId)
  return [...others.slice(0, undo.index), restored, ...others.slice(undo.index)]
}

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

/** What was typed for upload: paths separated by spaces, in quotes ("…" or '…') if they hold any. */
export const splitPaths = (input: string) =>
  [...input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
    .flatMap((m) => m[1] ?? m[2] ?? m[3] ?? [])
    .filter(Boolean)

/** A typed path made absolute: `~` is the home directory, as a shell would expand it. */
export function expandPath(path: string, cwd: string, home: string) {
  if (path === "~") return home
  return resolve(cwd, /^~[\\/]/.test(path) ? join(home, path.slice(2)) : path)
}
