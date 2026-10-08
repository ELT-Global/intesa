/**
 * The assignee views Shift+Arrow cycles through, as selections for the board's assignee filter:
 * the current user, each other member, Unassigned, then Everyone (the empty selection).
 */
export function assigneeViews(
  meId: string | undefined,
  memberIds: readonly string[],
  unassigned: string,
): string[][] {
  const others = memberIds.filter((id) => id !== meId).map((id) => [id])
  return [...(meId ? [[meId]] : []), ...others, [unassigned], []]
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
