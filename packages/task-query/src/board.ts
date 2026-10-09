import type { TaskStatus } from "./constants"

/** Where a card goes in its column: next to another card, or at either end. */
export type Placement = { before: string } | { after: string } | "first" | "last"

/**
 * `list` with `taskId` placed as the server will place it. The list is in board order, so a
 * column reads top to bottom in list order. Unchanged when the column has nothing to place the
 * task next to (an empty column: any spot in it is the same).
 */
export function placeTask<
  T extends { id: string; status: TaskStatus; parentTaskId?: string | null },
>(list: T[], taskId: string, placement: Placement): T[] {
  const task = list.find((t) => t.id === taskId)
  if (!task) return list
  const others = list.filter((t) => t.id !== taskId)
  const inColumn = (t: T) => t.status === task.status && !t.parentTaskId

  let at = -1
  if (placement === "first") at = others.findIndex(inColumn)
  else if (placement === "last") {
    const last = others.findLastIndex(inColumn)
    at = last < 0 ? -1 : last + 1
  } else {
    const anchor = "before" in placement ? placement.before : placement.after
    const found = others.findIndex((t) => t.id === anchor && inColumn(t))
    at = found < 0 ? -1 : found + ("after" in placement ? 1 : 0)
  }
  return at < 0 ? list : [...others.slice(0, at), task, ...others.slice(at)]
}

/** True when `placement` would leave `task` where it already is in its column. */
export function isInPlace<
  T extends { id: string; status: TaskStatus; parentTaskId?: string | null },
>(list: readonly T[], task: T, placement: Placement): boolean {
  const column = list.filter((t) => t.status === task.status && !t.parentTaskId)
  const at = column.findIndex((t) => t.id === task.id)
  if (placement === "first") return at === 0
  if (placement === "last") return at === column.length - 1
  if ("before" in placement) {
    return placement.before === task.id || column[at + 1]?.id === placement.before
  }
  return placement.after === task.id || column[at - 1]?.id === placement.after
}
