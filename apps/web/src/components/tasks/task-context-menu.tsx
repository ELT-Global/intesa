import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react"
import { notify } from "@/components/mutation-error-notice"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { meQuery } from "@/lib/queries"
import {
  dayFromToday,
  type TaskStatus,
  type TaskSummary,
  useDeleteTask,
  useUpdateTask,
} from "@/lib/tasks"
import { NO_PRIORITY, PriorityOptions, priorityFromValue, StatusOptions } from "./properties"
import { useTaskParam } from "./task-param"

const PRIMARY = "[data-task-primary]"

/**
 * Right-click (or Shift+F10 / the Menu key on the focused card or row) quick actions for one
 * task. Mark the element that takes focus with `data-task-primary`. Only the trigger and a
 * closed dialog live on each card; everything else mounts when the menu is opened.
 */
export function TaskContextMenu({ task, children }: { task: TaskSummary; children: ReactNode }) {
  const [confirming, setConfirming] = useState(false)
  const anchor = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  // Radix opens on the contextmenu event, which browsers do not reliably send for the
  // keyboard. Only the card's own button counts, not pickers inside a row.
  function openFromKeyboard(e: KeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement
    if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return
    // Stop the browser's own contextmenu event too, so a picker inside the row cannot open
    // the row menu and the primary element never opens two.
    e.preventDefault()
    if (e.repeat || !target.matches(PRIMARY)) return
    const box = target.getBoundingClientRect()
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 16,
        clientY: box.top + 16,
      }),
    )
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild ref={anchor} onKeyDown={openFromKeyboard}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent aria-label={`Actions for ${task.key}`}>
          <TaskMenuItems
            task={task}
            onDelete={() => {
              returnFocus.current = anchor.current?.querySelector<HTMLElement>(PRIMARY) ?? null
              setConfirming(true)
            }}
          />
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title="Delete task?"
          description={`${task.key} and its subtasks will be permanently removed.`}
          returnFocusRef={returnFocus}
        >
          <ConfirmDelete task={task} onClose={() => setConfirming(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function TaskMenuItems({ task, onDelete }: { task: TaskSummary; onDelete: () => void }) {
  const update = useUpdateTask()
  const me = useQuery(meQuery).data
  const { slug } = useParams({ strict: false })
  const { openTask } = useTaskParam()

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ taskId: task.id, projectId: task.projectId, patch: p })
  const assignedToMe = !!me && task.assignees.some((a) => a.id === me.id)

  function toggleMe() {
    if (!me) return
    const others = task.assignees.filter((a) => a.id !== me.id)
    const next = assignedToMe
      ? others
      : [...others, { id: me.id, name: me.name, avatarUrl: me.avatarUrl }]
    update.mutate({
      taskId: task.id,
      projectId: task.projectId,
      patch: { assigneeIds: next.map((a) => a.id) },
      view: { assignees: next },
    })
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      notify(`Copied ${what}`)
    } catch {
      notify("Could not copy to the clipboard.", "error")
    }
  }

  return (
    <>
      <ContextMenuItem onSelect={() => openTask(task.id)}>Open</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>Status</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            value={task.status}
            onValueChange={(v) => patch({ status: v as TaskStatus })}
          >
            <StatusOptions Item={ContextMenuRadioItem} />
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Priority</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            value={task.priority ?? NO_PRIORITY}
            onValueChange={(v) => patch({ priority: priorityFromValue(v) })}
          >
            <PriorityOptions Item={ContextMenuRadioItem} />
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {me && (
        <ContextMenuItem onSelect={toggleMe}>
          {assignedToMe ? "Unassign me" : "Assign to me"}
        </ContextMenuItem>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger>Due date</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => patch({ dueAt: dayFromToday(0) })}>
            Today
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => patch({ dueAt: dayFromToday(1) })}>
            Tomorrow
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => patch({ dueAt: dayFromToday(7) })}>
            Next week
          </ContextMenuItem>
          <ContextMenuItem disabled={!task.dueAt} onSelect={() => patch({ dueAt: null })}>
            Clear
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={!slug}
        onSelect={() =>
          copy(
            `${window.location.origin}/w/${slug}/projects/${task.projectId}?task=${task.id}`,
            "link",
          )
        }
      >
        Copy link
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => copy(task.key, task.key)}>Copy ID</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem destructive onSelect={onDelete}>
        Delete…
      </ContextMenuItem>
    </>
  )
}

function ConfirmDelete({ task, onClose }: { task: TaskSummary; onClose: () => void }) {
  const del = useDeleteTask()
  const { taskId, closeTask } = useTaskParam()
  return (
    <DialogFooter>
      <Button size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          onClose()
          // The sheet would otherwise be left showing a task that no longer exists.
          if (taskId === task.id) closeTask()
          del.mutate({
            taskId: task.id,
            projectId: task.projectId,
            parentTaskId: task.parentTaskId,
          })
        }}
      >
        Delete
      </Button>
    </DialogFooter>
  )
}
