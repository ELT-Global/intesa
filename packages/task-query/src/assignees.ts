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
