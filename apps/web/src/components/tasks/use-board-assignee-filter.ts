import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"
import { getBoardAssignees, setBoardAssignees } from "@/lib/preferences"
import { membersQuery, meQuery } from "@/lib/queries"
import { UNASSIGNED } from "./assignee-filter"

/**
 * The board's assignee filter, remembered per project. Defaults to the current user.
 * Saved ids that no longer match a workspace member are dropped; if nothing valid is left
 * the filter falls back to the current user. An explicit "everyone" (`[]`) is kept as is.
 */
export function useBoardAssigneeFilter(projectId: string, workspaceId: string | undefined) {
  const meId = useQuery(meQuery).data?.id
  const members = useQuery({ ...membersQuery(workspaceId ?? ""), enabled: !!workspaceId })
  // null = nothing saved, which resolves to the current user.
  const [saved, setSaved] = useState<string[] | null>(() => getBoardAssignees(projectId))

  const memberIds = useMemo(() => new Set(members.data?.map((m) => m.userId)), [members.data])
  const membersKnown = members.isSuccess

  const valid = useMemo(() => {
    if (saved === null || saved.length === 0) return saved
    if (!membersKnown) return saved
    const kept = saved.filter((id) => id === UNASSIGNED || memberIds.has(id))
    if (kept.length === saved.length) return saved
    return kept.length > 0 ? kept : null
  }, [saved, membersKnown, memberIds])

  // Write back corrections so stale entries don't linger in storage.
  useEffect(() => {
    if (valid === saved) return
    setSaved(valid)
    setBoardAssignees(projectId, valid)
  }, [valid, saved, projectId])

  const selected = useMemo(() => valid ?? (meId ? [meId] : []), [valid, meId])
  // Hold the board back until we know who to filter by, rather than flashing everyone's tasks.
  const ready =
    valid === null
      ? meId !== undefined
      : valid.length === 0 || membersKnown || members.isError

  const select = useCallback(
    (next: string[]) => {
      setSaved(next)
      setBoardAssignees(projectId, next)
    },
    [projectId],
  )

  return { selected, ready, meId, select }
}
