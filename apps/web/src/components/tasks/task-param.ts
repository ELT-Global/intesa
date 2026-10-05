import { useNavigate, useSearch } from "@tanstack/react-router"
import { useCallback } from "react"

/**
 * Reads and writes the `?task=<taskId>` search param that drives the detail sheet.
 * The host route should accept it with `validateSearch: (s) => ({ task: typeof s.task === "string" ? s.task : undefined })`.
 */
export function useTaskParam() {
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const taskId = typeof search.task === "string" && search.task ? search.task : null

  const setTask = useCallback(
    (id: string | null) => {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, task: id ?? undefined }),
        replace: id === null,
      })
    },
    [navigate],
  )

  return {
    taskId,
    openTask: useCallback((id: string) => setTask(id), [setTask]),
    closeTask: useCallback(() => setTask(null), [setTask]),
  }
}
