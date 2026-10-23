import type { Placement, TaskStatus } from "@intesa/task-query"
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react"
import { type TaskSummary, useUpdateTask } from "@/lib/tasks"
import { type CompletionAnswers, CompletionDialog } from "./completion-dialog"

type MovingTask = Pick<
  TaskSummary,
  "id" | "key" | "title" | "projectId" | "status" | "parentTaskId"
>

export type StatusChange = {
  task: MovingTask
  status: TaskStatus
  /** Where in the new column, for a board move. */
  placement?: Placement
  /** Runs when the change is applied: at once, or after the dialog is confirmed. */
  onApplied?: () => void
  /** Runs when the dialog was dismissed and nothing changed. */
  onCancel?: () => void
  /** Gets focus back when the dialog closes; for changes made from a menu. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/** A top-level task entering Complete has to be signed off first; subtasks never are. */
const needsSignoff = (task: MovingTask, status: TaskStatus) =>
  status === "complete" && task.status !== "complete" && !task.parentTaskId

const StatusChangeContext = createContext<((change: StatusChange) => void) | null>(null)

/**
 * The single way a task's status changes from the UI. Moves into Complete open the completion
 * dialog first and send one request with the answers; nothing is changed (or shown as changed)
 * until it is confirmed.
 */
export function useStatusChange() {
  const change = useContext(StatusChangeContext)
  if (!change) throw new Error("useStatusChange needs a StatusChangeProvider")
  return change
}

/** Owns the one completion dialog that every status change in the app goes through. */
export function StatusChangeProvider({ children }: { children: ReactNode }) {
  const update = useUpdateTask()
  const [pending, setPending] = useState<StatusChange | null>(null)
  // What had focus when the dialog opened; the dialog has no trigger of its own to return to.
  const opener = useRef<HTMLElement | null>(null)
  const returnTo = useRef<RefObject<HTMLElement | null>>(opener)

  const apply = useCallback(
    ({ task, status, placement, onApplied }: StatusChange, answers?: CompletionAnswers) => {
      update.mutate({
        taskId: task.id,
        projectId: task.projectId,
        patch: {
          status,
          ...(placement && { placement }),
          ...(answers && {
            reviewedById: answers.reviewedBy?.id ?? null,
            testedById: answers.testedBy?.id ?? null,
          }),
        },
        view: answers && { reviewedBy: answers.reviewedBy, testedBy: answers.testedBy },
      })
      // After the update has started: callers look at the task's new state, which it sets first.
      onApplied?.()
    },
    [update.mutate],
  )

  const change = useCallback(
    (request: StatusChange) => {
      if (!needsSignoff(request.task, request.status)) return apply(request)
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      returnTo.current = request.returnFocusRef ?? opener
      setPending(request)
    },
    [apply],
  )

  return (
    <StatusChangeContext.Provider value={change}>
      {children}
      <CompletionDialog
        target={
          pending && {
            projectId: pending.task.projectId,
            taskId: pending.task.id,
            label: `${pending.task.key} ${pending.task.title}`,
            returnFocusRef: returnTo.current,
          }
        }
        onConfirm={(answers) => {
          if (pending) apply(pending, answers)
          setPending(null)
        }}
        onCancel={() => {
          pending?.onCancel?.()
          setPending(null)
        }}
      />
    </StatusChangeContext.Provider>
  )
}
