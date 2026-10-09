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
