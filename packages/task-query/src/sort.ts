import { PRIORITY_RANK, TASK_STATUSES, type TaskPriority, type TaskStatus } from "./constants"

export type SortKey = "task" | "status" | "priority" | "due"
export type Sort = { key: SortKey; dir: "asc" | "desc" }

type SortableTask = {
  title: string
  status: TaskStatus
  priority: TaskPriority | null
  dueAt: string | null
}

/** The task table's order. Missing values always sort last, whichever direction is active. */
export function compareBy(sort: Sort): <T extends SortableTask>(a: T, b: T) => number {
  const sign = sort.dir === "asc" ? 1 : -1
  const value = (t: SortableTask): string | number | null => {
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

/** Sorting by the same key again flips the direction; a new key starts ascending. */
export const nextSort = (current: Sort | null, key: SortKey): Sort =>
  current?.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
