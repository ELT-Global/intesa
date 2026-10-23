import type { TaskStatus } from "./constants"

/** The assignee filter's entry for tasks with no assignee, next to user ids. */
export const UNASSIGNED = "unassigned"

/** Whether the board's assignee filter shows `task`. An empty selection is everyone. */
export function matchesAssignees(
  task: { assignees: readonly { id: string }[] },
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true
  return task.assignees.length === 0
    ? selected.includes(UNASSIGNED)
    : task.assignees.some((a) => selected.includes(a.id))
}

/**
 * The assignee views Shift+Arrow cycles through, as selections for the board's assignee filter:
 * the current user, each other member, Unassigned, then Everyone (the empty selection).
 */
export function assigneeViews(meId: string | undefined, memberIds: readonly string[]): string[][] {
  const others = memberIds.filter((id) => id !== meId).map((id) => [id])
  return [...(meId ? [[meId]] : []), ...others, [UNASSIGNED], []]
}

/**
 * The view `delta` steps from `current`, wrapping around. A selection that is not one of the views
 * (several people picked by hand) steps to the first view going forward, the last going back.
 */
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

/**
 * Who a new task starts assigned to: the one person the board is filtered to, nobody when it is
 * filtered to Unassigned, otherwise (several people, or everyone) the creator.
 */
export function newTaskAssignees(selected: readonly string[], meId: string | undefined): string[] {
  if (selected.length === 1) return selected[0] === UNASSIGNED ? [] : [selected[0] as string]
  return meId ? [meId] : []
}

/** The statuses that mean someone is doing the work, or has done it. */
const WORK_STATUSES: readonly TaskStatus[] = ["in_progress", "review", "complete"]

/**
 * Whether moving `task` to `status` should first ask the mover who did the work: it changes
 * status into In progress, Review or Complete, it has assignees, and the mover (`meId`) is not one
 * of them. Answering "me" then reassigns it to the mover.
 */
export function asksWhoDidIt(
  task: { status: TaskStatus; assignees: readonly { id: string }[] },
  status: TaskStatus,
  meId: string | undefined,
): boolean {
  return (
    meId !== undefined &&
    task.status !== status &&
    WORK_STATUSES.includes(status) &&
    task.assignees.length > 0 &&
    !task.assignees.some((a) => a.id === meId)
  )
}

/** "Ada", "Ada and Grace", "Ada, Grace and Alan". */
export function joinNames(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}
