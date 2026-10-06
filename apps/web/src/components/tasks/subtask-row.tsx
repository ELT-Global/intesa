import { Ellipsis } from "lucide-react"
import { useEffect, useRef, useState } from "react"
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
import {
  type TaskDetail,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
  useDeleteTask,
  useUpdateTask,
} from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { AssigneePicker } from "./assignee-picker"
import {
  NO_PRIORITY,
  PriorityIcon,
  PriorityOptions,
  priorityFromValue,
  StatusIcon,
  StatusOptions,
} from "./properties"
import { TaskKey } from "./task-key"

// Controls other than the status icon and set values fade in on hover or focus at md+, and
// are always shown on touch widths where there is no hover.
const REVEAL =
  "transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"

/** One compact, editable subtask line inside the parent's sheet. */
export function SubtaskRow({
  parent,
  subtask,
  workspaceId,
  onOpen,
  onRequestDelete,
}: {
  parent: TaskDetail
  subtask: TaskSummary
  workspaceId: string
  onOpen: () => void
  onRequestDelete: (request: DeleteRequest) => void
}) {
  const update = useUpdateTask()
  const [editing, setEditing] = useState(false)
  const complete = subtask.status === "complete"
  const rowRef = useRef<HTMLLIElement>(null)
  const titleRef = useRef<HTMLButtonElement>(null)
  const actionsRef = useRef<HTMLButtonElement>(null)
  // Set when a keyboard action ended the edit, so focus goes back to the title button.
  const refocusTitle = useRef(false)

  useEffect(() => {
    if (!editing && refocusTitle.current) {
      refocusTitle.current = false
      titleRef.current?.focus()
    }
  }, [editing])

  const base = { taskId: subtask.id, projectId: subtask.projectId, parentTaskId: parent.id }

  function setPriority(priority: TaskPriority | null) {
    update.mutate({ ...base, patch: { priority } })
  }

  function setTitle(title: string) {
    update.mutate({ ...base, patch: { title } })
  }

  return (
    <li
      ref={rowRef}
      className="group flex h-8 items-center gap-1.5 rounded-md hover:bg-accent/60 focus-within:bg-accent/60"
    >
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
            <StatusOptions Item={DropdownMenuRadioItem} />
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
          onDone={(next, byKeyboard) => {
            refocusTitle.current = byKeyboard
            setEditing(false)
            if (next !== null && next !== subtask.title) setTitle(next)
          }}
        />
      ) : (
        <button
          ref={titleRef}
          data-subtask-title
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
            onValueChange={(v) => setPriority(priorityFromValue(v))}
          >
            <PriorityOptions Item={DropdownMenuRadioItem} />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className={cn(subtask.assignees.length === 0 && REVEAL)}>
        <AssigneePicker compact task={subtask} workspaceId={workspaceId} parentTaskId={parent.id} />
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={actionsRef}
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
          <DropdownMenuItem
            onSelect={() =>
              onRequestDelete({ subtask, row: rowRef.current, actions: actionsRef.current })
            }
          >
            Delete subtask
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

export type DeleteRequest = {
  subtask: TaskSummary
  row: HTMLElement | null
  /** The row's actions trigger; focus returns here when the delete is cancelled. */
  actions: HTMLElement | null
}

/**
 * One confirm dialog for the whole list, so it outlives the row it deletes and Radix can hand
 * focus on close: back to the actions trigger on cancel, to the next subtask (or the add field)
 * after a delete.
 */
export function DeleteSubtaskDialog({
  parent,
  request,
  onClose,
}: {
  parent: TaskDetail
  request: DeleteRequest | null
  onClose: () => void
}) {
  const remove = useDeleteTask()
  const focusTarget = useRef<HTMLElement | null>(null)
  // The dialog keeps showing the subtask while it animates closed.
  const shown = useRef(request)
  if (request) shown.current = request
  const current = shown.current

  function close(next: HTMLElement | null) {
    focusTarget.current = next
    onClose()
  }

  function confirm() {
    if (!current) return
    const { subtask, row } = current
    const nextTitle = row?.nextElementSibling?.querySelector<HTMLElement>("[data-subtask-title]")
    const addField = row
      ?.closest("section")
      ?.querySelector<HTMLElement>('input[aria-label="Add subtask"]')
    close(nextTitle ?? addField ?? null)
    remove.mutate({
      taskId: subtask.id,
      projectId: subtask.projectId,
      parentTaskId: parent.id,
    })
  }

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => !open && close(current?.actions ?? null)}
    >
      <DialogContent
        title="Delete subtask?"
        description={current ? `${current.subtask.key} will be permanently removed.` : undefined}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          focusTarget.current?.focus()
        }}
      >
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => close(current?.actions ?? null)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={confirm}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Enter or blur saves, Escape cancels; an empty title counts as a cancel. */
function TitleInput({
  value,
  onDone,
}: {
  value: string
  onDone: (next: string | null, byKeyboard: boolean) => void
}) {
  const [draft, setDraft] = useState(value)
  const finished = useRef(false)
  const finish = (next: string | null, byKeyboard = false) => {
    if (finished.current) return
    finished.current = true
    onDone(next, byKeyboard)
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
        // The title button takes focus as the edit ends; without this its Enter activation would
        // fire on the same keypress and reopen the editor.
        if (e.key === "Enter") {
          e.preventDefault()
          finish(draft.trim() || null, true)
        }
        if (e.key === "Escape") finish(null, true)
      }}
      onBlur={() => finish(draft.trim() || null)}
      className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24"
    />
  )
}
