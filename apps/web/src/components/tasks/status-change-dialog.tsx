import { joinNames } from "@intesa/task-query"
import { useQuery } from "@tanstack/react-query"
import { type RefObject, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { projectQuery } from "@/lib/queries"
import { taskQuery, type UserRef } from "@/lib/tasks"
import { type Signoff, SignoffPicker } from "./signoff-picker"

/** Who reviewed and who tested a task (null for nobody), asked to complete it. */
export type SignoffAnswers = {
  reviewedBy: UserRef | null
  testedBy: UserRef | null
}

type SignoffKey = keyof SignoffAnswers

const SIGNOFF: { key: SignoffKey; label: string }[] = [
  { key: "reviewedBy", label: "Reviewed by" },
  { key: "testedBy", label: "Tested by" },
]

/** The answers given; a part is present only if its question was asked. */
export type StatusChangeAnswers = {
  /** "Who did it?": the person making the change rather than the assignees. */
  byMe?: boolean
  signoff?: SignoffAnswers
}

/** What the dialog is asked about: an existing task (its sign-off prefills) or one to be created. */
export type StatusChangeTarget = {
  projectId: string
  /** Absent for a task that does not exist yet. */
  taskId?: string
  /** Shown in the description: "WEB-3 Fix the build", "the new task". */
  label: string
  /** Asks "Who did it?" between these assignees and the person making the change. */
  assignees?: UserRef[]
  /** Asks who reviewed and who tested it, which completes the task. */
  signoff?: boolean
  /** Gets focus back on close, for a dialog opened from a menu item. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Asks what a status change needs to know: who did the work, and, to complete a task, who
 * reviewed and tested it. The caller owns what happens next; this only collects the answers and
 * calls `onConfirm` once every question asked is answered.
 */
export function StatusChangeDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: StatusChangeTarget | null
  onConfirm: (answers: StatusChangeAnswers) => void
  onCancel: () => void
}) {
  // The dialog keeps showing the last target while it animates closed.
  const shown = useRef(target)
  if (target) shown.current = target
  const current = shown.current
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onCancel()}>
      {current && (
        <StatusChangeContent
          key={`${current.taskId ?? current.label}-${!!current.assignees}-${!!current.signoff}`}
          target={current}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
    </Dialog>
  )
}

type ContentProps = {
  target: StatusChangeTarget
  onConfirm: (answers: StatusChangeAnswers) => void
  onCancel: () => void
}

function StatusChangeContent(props: ContentProps) {
  const { taskId, signoff } = props.target
  return taskId && signoff ? <PrefilledForm {...props} taskId={taskId} /> : <Form {...props} />
}

/** The form for an existing task, starting from the sign-off it already has. */
function PrefilledForm({ taskId, ...props }: ContentProps & { taskId: string }) {
  // The list may have been showing an older copy; the answers are fetched again when it opens.
  const detail = useQuery({ ...taskQuery(taskId), refetchOnMount: "always" })
  return <Form {...props} prefill={detail.data} />
}

const names = (people: UserRef[]) => joinNames(people.map((p) => p.name))

function describe({ label, assignees, signoff }: StatusChangeTarget) {
  if (!assignees) return `Say who reviewed and who tested ${label} before completing it.`
  const also = signoff ? ", who reviewed it and who tested it before completing it" : ""
  return `${label} is assigned to ${names(assignees)}. Say who did it${also}.`
}

function Form({
  target,
  prefill,
  onConfirm,
  onCancel,
}: ContentProps & { prefill?: { [K in SignoffKey]?: Signoff } }) {
  const { assignees, signoff } = target
  const workspaceId = useQuery(projectQuery(target.projectId)).data?.workspaceId
  // Only what has been picked here; the sign-off otherwise shows the task's current answer.
  const [who, setWho] = useState<"assignees" | "me">()
  const [picked, setPicked] = useState<Partial<SignoffAnswers>>({})
  const signoffAnswer = (key: SignoffKey): Signoff => (key in picked ? picked[key] : prefill?.[key])
  const ready =
    (!assignees || who !== undefined) &&
    (!signoff || SIGNOFF.every((q) => signoffAnswer(q.key) !== undefined))

  function confirm() {
    onConfirm({
      ...(assignees && { byMe: who === "me" }),
      ...(signoff && {
        signoff: {
          reviewedBy: signoffAnswer("reviewedBy") ?? null,
          testedBy: signoffAnswer("testedBy") ?? null,
        },
      }),
    })
  }

  return (
    <DialogContent
      title={signoff ? "Complete task" : "Move task"}
      returnFocusRef={target.returnFocusRef}
      description={describe(target)}
    >
      <div className="flex flex-col gap-3">
        {assignees && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="text-[13px]">Who did it?</span>
            <SegmentedControl
              label="Who did it?"
              value={who ?? null}
              onChange={setWho}
              segments={[
                { value: "assignees", label: names(assignees) },
                { value: "me", label: "Me" },
              ]}
            />
          </div>
        )}
        {signoff &&
          SIGNOFF.map((q) => (
            <div key={q.key} className="flex items-center justify-between gap-3">
              <span className="text-[13px]">{q.label}</span>
              {workspaceId && (
                <SignoffPicker
                  field
                  label={q.label}
                  workspaceId={workspaceId}
                  value={signoffAnswer(q.key)}
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
        <Button variant="primary" size="sm" disabled={!ready} onClick={confirm}>
          {signoff ? "Complete" : "Move"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
