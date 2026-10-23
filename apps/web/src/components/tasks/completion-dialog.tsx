import { useQuery } from "@tanstack/react-query"
import { type RefObject, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { projectQuery } from "@/lib/queries"
import { taskQuery, type UserRef } from "@/lib/tasks"
import { type Signoff, SignoffPicker } from "./signoff-picker"

/** The answers asked for when a task is completed. A follow-up adds "Who did it?" here. */
export type CompletionAnswers = {
  reviewedBy: UserRef | null
  testedBy: UserRef | null
}

const QUESTIONS: { key: keyof CompletionAnswers; label: string }[] = [
  { key: "reviewedBy", label: "Reviewed by" },
  { key: "testedBy", label: "Tested by" },
]

/** What the dialog is asked about: an existing task (its answers prefill) or one to be created. */
export type CompletionTarget = {
  projectId: string
  /** Absent for a task that does not exist yet. */
  taskId?: string
  /** Shown in the description: "WEB-3 Fix the build", "the new task". */
  label: string
  /** Gets focus back on close, for a dialog opened from a menu item. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Asks who reviewed and who tested a task before it is completed. The caller owns what happens
 * next; this only collects the answers and calls `onConfirm` once every question is answered.
 */
export function CompletionDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: CompletionTarget | null
  onConfirm: (answers: CompletionAnswers) => void
  onCancel: () => void
}) {
  // The dialog keeps showing the last target while it animates closed.
  const shown = useRef(target)
  if (target) shown.current = target
  const current = shown.current
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onCancel()}>
      {current && (
        <CompletionContent
          key={current.taskId ?? current.label}
          target={current}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
    </Dialog>
  )
}

type ContentProps = {
  target: CompletionTarget
  onConfirm: (answers: CompletionAnswers) => void
  onCancel: () => void
}

function CompletionContent(props: ContentProps) {
  const { taskId } = props.target
  return taskId ? <PrefilledContent {...props} taskId={taskId} /> : <CompletionForm {...props} />
}

/** The form for an existing task, starting from the answers it already has. */
function PrefilledContent({ taskId, ...props }: ContentProps & { taskId: string }) {
  // The list may have been showing an older copy; the answers are fetched again when it opens.
  const detail = useQuery({ ...taskQuery(taskId), refetchOnMount: "always" })
  return <CompletionForm {...props} prefill={detail.data} />
}

function CompletionForm({
  target,
  prefill,
  onConfirm,
  onCancel,
}: ContentProps & { prefill?: { [K in keyof CompletionAnswers]?: Signoff } }) {
  const workspaceId = useQuery(projectQuery(target.projectId)).data?.workspaceId
  // Only what has been picked here; everything else shows the task's current answer.
  const [picked, setPicked] = useState<Partial<CompletionAnswers>>({})
  const answer = (key: keyof CompletionAnswers): Signoff =>
    key in picked ? picked[key] : prefill?.[key]
  const complete = QUESTIONS.every((q) => answer(q.key) !== undefined)

  return (
    <DialogContent
      title="Complete task"
      returnFocusRef={target.returnFocusRef}
      description={`Say who reviewed and who tested ${target.label} before completing it.`}
    >
      <div className="flex flex-col gap-3">
        {QUESTIONS.map((q) => (
          <div key={q.key} className="flex items-center justify-between gap-3">
            <span className="text-[13px]">{q.label}</span>
            {workspaceId && (
              <SignoffPicker
                field
                label={q.label}
                workspaceId={workspaceId}
                value={answer(q.key)}
                onChange={(user) => setPicked((p) => ({ ...p, [q.key]: user }))}
              />
            )}
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!complete}
          onClick={() =>
            onConfirm({
              reviewedBy: answer("reviewedBy") ?? null,
              testedBy: answer("testedBy") ?? null,
            })
          }
        >
          Complete
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
