import { asksWhoDidIt, type Placement, type TaskStatus } from "@intesa/task-query"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react"
import { meQuery, workspacesQuery } from "@/lib/queries"
import { type TaskSummary, type UserRef, useUpdateTask } from "@/lib/tasks"
import { type StatusChangeAnswers, StatusChangeDialog } from "./status-change-dialog"

type MovingTask = Pick<
  TaskSummary,
  "id" | "key" | "title" | "projectId" | "status" | "parentTaskId" | "assignees" | "pullRequests"
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

/** What a change has to ask about, decided once when it is requested. */
type Ask = { signoff: boolean; assignees?: UserRef[]; pullRequest: boolean }

/** A top-level task entering Complete has to be signed off first; subtasks never are. */
const needsSignoff = (task: MovingTask, status: TaskStatus) =>
  status === "complete" && task.status !== "complete" && !task.parentTaskId

/** Starting a task without a PR offers to link one, where the workspace has GitHub connected. */
const offersPullRequest = (task: MovingTask, status: TaskStatus, github: boolean) =>
  github && status === "in_progress" && task.status !== "in_progress" && !task.pullRequests.length

const StatusChangeContext = createContext<((change: StatusChange) => void) | null>(null)

/**
 * The single way a task's status changes from the UI. Moves that need answers (who did it, who
 * reviewed and tested it) open the dialog first and send one request with them; nothing is
 * changed (or shown as changed) until it is confirmed.
 */
export function useStatusChange() {
  const change = useContext(StatusChangeContext)
  if (!change) throw new Error("useStatusChange needs a StatusChangeProvider")
  return change
}

/** Owns the one dialog that every status change in the app goes through. */
export function StatusChangeProvider({ children }: { children: ReactNode }) {
  const update = useUpdateTask()
  const me = useQuery(meQuery).data
  // Moves happen inside a workspace's pages, so its slug is in the URL.
  const { slug } = useParams({ strict: false })
  const github = useQuery(workspacesQuery).data?.find((w) => w.slug === slug)?.github ?? false
  const [pending, setPending] = useState<{ request: StatusChange; ask: Ask } | null>(null)
  // What had focus when the dialog opened; the dialog has no trigger of its own to return to.
  const opener = useRef<HTMLElement | null>(null)
  const returnTo = useRef<RefObject<HTMLElement | null>>(opener)

  const apply = useCallback(
    (
      { task, status, placement, onApplied }: StatusChange,
      { byMe, signoff, pullRequest }: StatusChangeAnswers = {},
    ) => {
      const mover =
        byMe && me ? { id: me.id, name: me.name, avatarUrl: me.avatarUrl ?? null } : null
      update.mutate({
        taskId: task.id,
        projectId: task.projectId,
        parentTaskId: task.parentTaskId,
        patch: {
          status,
          ...(placement && { placement }),
          ...(mover && { assigneeIds: [mover.id] }),
          ...(pullRequest && { pullRequest }),
          ...(signoff && {
            reviewedById: signoff.reviewedBy?.id ?? null,
            testedById: signoff.testedBy?.id ?? null,
          }),
        },
        view: mover || signoff ? { assignees: mover ? [mover] : undefined, ...signoff } : undefined,
      })
      // After the update has started: callers look at the task's new state, which it sets first.
      onApplied?.()
    },
    [update.mutate, me],
  )

  const change = useCallback(
    (request: StatusChange) => {
      const { task, status } = request
      const ask: Ask = {
        signoff: needsSignoff(task, status),
        assignees: asksWhoDidIt(task, status, me?.id) ? task.assignees : undefined,
        pullRequest: offersPullRequest(task, status, github),
      }
      if (!ask.signoff && !ask.assignees && !ask.pullRequest) return apply(request)
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      returnTo.current = request.returnFocusRef ?? opener
      setPending({ request, ask })
    },
    [apply, me?.id, github],
  )

  return (
    <StatusChangeContext.Provider value={change}>
      {children}
      <StatusChangeDialog
        target={
          pending && {
            projectId: pending.request.task.projectId,
            taskId: pending.request.task.id,
            label: `${pending.request.task.key} ${pending.request.task.title}`,
            ...pending.ask,
            returnFocusRef: returnTo.current,
          }
        }
        onConfirm={(answers) => {
          if (pending) apply(pending.request, answers)
          setPending(null)
        }}
        onCancel={() => {
          pending?.request.onCancel?.()
          setPending(null)
        }}
      />
    </StatusChangeContext.Provider>
  )
}
