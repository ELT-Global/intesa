import { STATUS_LABELS } from "@intesa/task-query"
import { type RefObject, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { FormError } from "@/components/ui/field"
import { ApiError } from "@/lib/api"
import { type TaskDetail, type TaskSummary, type UserRef, usePromoteSubtask } from "@/lib/tasks"
import { AssigneePicker } from "./assignee-picker"
import { useTaskParam } from "./task-param"

export type PromoteRequest = {
  subtask: TaskSummary
  row: HTMLElement | null
  /** The row's actions trigger; focus returns here when the dialog is cancelled. */
  actions: HTMLElement | null
}

/**
 * Asks who a subtask should be assigned to as a top-level task, then converts it (ADR 0033).
 * One dialog for the whole list, so it outlives the row that leaves the list on success.
 */
export function PromoteSubtaskDialog({
  parent,
  workspaceId,
  request,
  onClose,
}: {
  parent: TaskDetail
  workspaceId: string
  request: PromoteRequest | null
  onClose: () => void
}) {
  // The dialog keeps showing the subtask while it animates closed.
  const shown = useRef(request)
  if (request) shown.current = request
  const current = shown.current
  const focusTarget = useRef<HTMLElement | null>(null)
  // Where focus goes once the converted row has left the list, whichever way the dialog closes.
  const afterConvert = useRef<HTMLElement | null>(null)

  function close(next: HTMLElement | null) {
    focusTarget.current = next
    onClose()
  }

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => !open && close(current?.actions ?? null)}
    >
      {current && (
        <PromoteContent
          key={current.subtask.id}
          parent={parent}
          workspaceId={workspaceId}
          request={current}
          onClose={close}
          afterConvert={afterConvert}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            // The actions trigger is detached once its row has left the list.
            const target = focusTarget.current?.isConnected
              ? focusTarget.current
              : afterConvert.current
            target?.focus()
          }}
        />
      )}
    </Dialog>
  )
}

function PromoteContent({
  parent,
  workspaceId,
  request,
  onClose,
  afterConvert,
  onCloseAutoFocus,
}: {
  parent: TaskDetail
  workspaceId: string
  request: PromoteRequest
  onClose: (focus: HTMLElement | null) => void
  afterConvert: RefObject<HTMLElement | null>
  onCloseAutoFocus: (e: Event) => void
}) {
  const { subtask, row, actions } = request
  const { openTask } = useTaskParam()
  const promote = usePromoteSubtask(subtask, parent.id)
  // Defaults to whoever has the subtask now.
  const [assignees, setAssignees] = useState<UserRef[]>(subtask.assignees)
  const done = promote.isSuccess

  function convert() {
    // Read while the row is still in the list: the next subtask, or the add field.
    afterConvert.current =
      row?.nextElementSibling?.querySelector<HTMLElement>("[data-subtask-title]") ??
      row?.closest("section")?.querySelector<HTMLElement>('input[aria-label="Add subtask"]') ??
      null
    promote.mutate(assignees.map((a) => a.id))
  }

  return (
    <DialogContent
      title={done ? `${subtask.key} is now a task` : "Convert to task"}
      description={
        done
          ? `It is on the board in ${STATUS_LABELS[subtask.status]}.`
          : `${subtask.key} will no longer be a subtask of ${parent.key}. It joins the board in ${STATUS_LABELS[subtask.status]}.`
      }
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {!done && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Assign to</span>
            <AssigneePicker workspaceId={workspaceId} value={assignees} onChange={setAssignees} />
          </div>
          <FormError
            message={
              promote.error &&
              (promote.error instanceof ApiError && promote.error.status < 500
                ? promote.error.message
                : "Could not convert the subtask.")
            }
          />
        </>
      )}
      <DialogFooter>
        {done ? (
          <>
            <Button size="sm" onClick={() => onClose(afterConvert.current)}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onClose(null)
                openTask(subtask.id)
              }}
            >
              Open task
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => onClose(actions)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" pending={promote.isPending} onClick={convert}>
              Convert to task
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  )
}
