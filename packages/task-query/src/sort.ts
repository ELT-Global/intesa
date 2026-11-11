import { PRIORITY_RANK, TASK_STATUSES, type TaskPriority, type TaskStatus } from "./constants"

export type SortKey = "task" | "status" | "priority" | "due"
/** A table's order; other tables (the bugs table) bring their own keys. */
export type Sort<K extends string = SortKey> = { key: K; dir: "asc" | "desc" }

type SortableTask = {
  title: string
  status: TaskStatus
  priority: TaskPriority | null
  dueAt: string | null
}

/** Orders by `value`. Missing values always sort last, whichever direction is active. */
export function orderBy<T>(
  value: (item: T) => string | number | null,
  dir: Sort<string>["dir"],
): (a: T, b: T) => number {
  const sign = dir === "asc" ? 1 : -1
  return (a, b) => {
    const x = value(a)
    const y = value(b)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return (x < y ? -1 : 1) * sign
  }
}

/** The task table's order. */
export function compareBy(sort: Sort): <T extends SortableTask>(a: T, b: T) => number {
  return orderBy((t: SortableTask) => {
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
  }, sort.dir)
}

/** Sorting by the same key again flips the direction; a new key starts ascending. */
export const nextSort = <K extends string>(current: Sort<K> | null, key: K): Sort<K> =>
  current?.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
