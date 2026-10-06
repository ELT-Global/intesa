import { useQueryClient } from "@tanstack/react-query"
import { Ellipsis } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { patchSubtask, removeSubtask } from "@/lib/subtasks"
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskDetail,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
  useDeleteTask,
  useUpdateTask,
} from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { AssigneePicker } from "./assignee-picker"
import { PRIORITY_LABELS, PriorityIcon, STATUS_LABELS, StatusIcon } from "./properties"
import { TaskKey } from "./task-key"

const NO_PRIORITY = "none"

// Controls other than the status icon and set values fade in on hover or focus at md+, and
// are always shown on touch widths where there is no hover.
const REVEAL = "md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"

/** One compact, editable subtask line inside the parent's sheet. */
export function SubtaskRow({
  parent,
  subtask,
  workspaceId,
  onOpen,
}: {
  parent: TaskDetail
  subtask: TaskSummary
  workspaceId: string
  onOpen: () => void
}) {
  const qc = useQueryClient()
  const update = useUpdateTask()
  const remove = useDeleteTask()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const complete = subtask.status === "complete"

  const base = { taskId: subtask.id, projectId: subtask.projectId, parentTaskId: parent.id }

  function setPriority(priority: TaskPriority | null) {
    patchSubtask(qc, parent.id, subtask.id, { priority })
    update.mutate({ ...base, patch: { priority } })
  }

  function setTitle(title: string) {
    patchSubtask(qc, parent.id, subtask.id, { title })
    update.mutate({ ...base, patch: { title } })
  }

  return (
    <li className="group flex h-8 items-center gap-1.5 rounded-md hover:bg-accent/60 focus-within:bg-accent/60">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Change status of ${subtask.title}`}
            className="touch-target flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StatusIcon status={subtask.status} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={subtask.status}
            onValueChange={(v) => update.mutate({ ...base, patch: { status: v as TaskStatus } })}
          >
            {TASK_STATUSES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                <StatusIcon status={s} />
                {STATUS_LABELS[s]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        aria-label={`Open ${subtask.title}`}
        onClick={onOpen}
        className="shrink-0 cursor-pointer rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TaskKey>{subtask.key}</TaskKey>
      </button>

      {editing ? (
        <TitleInput
          value={subtask.title}
          onDone={(next) => {
            setEditing(false)
            if (next !== null && next !== subtask.title) setTitle(next)
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            "min-w-0 flex-1 cursor-text truncate rounded px-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
            complete && "text-muted-foreground line-through",
          )}
        >
          {subtask.title}
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={`Change priority of ${subtask.title}`}
            className={cn("size-6", !subtask.priority && REVEAL)}
          >
            <PriorityIcon priority={subtask.priority} className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={subtask.priority ?? NO_PRIORITY}
            onValueChange={(v) => setPriority(v === NO_PRIORITY ? null : (v as TaskPriority))}
          >
            <DropdownMenuRadioItem value={NO_PRIORITY}>
              <PriorityIcon priority={null} className="size-4" />
              No priority
            </DropdownMenuRadioItem>
            {TASK_PRIORITIES.map((p) => (
              <DropdownMenuRadioItem key={p} value={p}>
                <PriorityIcon priority={p} className="size-4" />
                {PRIORITY_LABELS[p]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className={cn(subtask.assignees.length === 0 && REVEAL)}>
        <AssigneePicker compact task={subtask} workspaceId={workspaceId} parentTaskId={parent.id} />
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={`Actions for ${subtask.title}`}
            className={cn("size-6", REVEAL)}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onOpen}>Open subtask</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirming(true)}>Delete subtask</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title="Delete subtask?"
          description={`${subtask.key} will be permanently removed.`}
        >
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirming(false)
                removeSubtask(qc, parent.id, subtask.id)
                remove.mutate({ taskId: subtask.id, projectId: subtask.projectId })
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  )
}

/** Enter or blur saves, Escape cancels; an empty title counts as a cancel. */
function TitleInput({ value, onDone }: { value: string; onDone: (next: string | null) => void }) {
  const [draft, setDraft] = useState(value)
  const finished = useRef(false)
  const finish = (next: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(next)
  }
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the field only appears because the user asked to edit
      autoFocus
      data-keeps-escape
      aria-label="Subtask title"
      value={draft}
      maxLength={500}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(draft.trim() || null)
        if (e.key === "Escape") {
          // Escape would otherwise close the whole sheet.
          e.stopPropagation()
          finish(null)
        }
      }}
      onBlur={() => finish(draft.trim() || null)}
      className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24"
    />
  )
}
