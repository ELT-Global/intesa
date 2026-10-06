import type { QueryClient } from "@tanstack/react-query"
import { type TaskDetail, type TaskSummary, taskKeys } from "./tasks"

/**
 * Optimistic edits to a subtask as shown inside its parent's cached detail. The server copy
 * returns when the task mutations settle and refresh the cache, which also undoes a failed edit.
 */
export function patchSubtask(
  qc: QueryClient,
  parentId: string,
  subtaskId: string,
  changes: Partial<TaskSummary>,
) {
  qc.setQueryData<TaskDetail>(taskKeys.detail(parentId), (parent) =>
    parent
      ? {
          ...parent,
          subtasks: parent.subtasks.map((s) => (s.id === subtaskId ? { ...s, ...changes } : s)),
        }
      : parent,
  )
}

export function removeSubtask(qc: QueryClient, parentId: string, subtaskId: string) {
  qc.setQueryData<TaskDetail>(taskKeys.detail(parentId), (parent) => {
    if (!parent) return parent
    const subtasks = parent.subtasks.filter((s) => s.id !== subtaskId)
    return {
      ...parent,
      subtasks,
      subtaskCount: subtasks.length,
      subtaskDoneCount: subtasks.filter((s) => s.status === "complete").length,
    }
  })
}
