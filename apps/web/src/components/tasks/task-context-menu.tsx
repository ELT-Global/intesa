import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { type KeyboardEvent, type ReactNode, useState } from "react"
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
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { meQuery } from "@/lib/queries"
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
  useDeleteTask,
  useUpdateTask,
} from "@/lib/tasks"
import { PRIORITY_LABELS, PriorityIcon, STATUS_LABELS, StatusIcon } from "./properties"
import { useTaskParam } from "./task-param"

const NO_PRIORITY = "none"

function isoDay(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Right-click (or Shift+F10 on a focused card or row) quick actions for one task. */
export function TaskContextMenu({ task, children }: { task: TaskSummary; children: ReactNode }) {
  const update = useUpdateTask()
  const del = useDeleteTask()
  const me = useQuery(meQuery).data
  const { slug } = useParams({ strict: false })
  const { taskId, openTask, closeTask } = useTaskParam()
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  function copy(text: string) {
    void navigator.clipboard?.writeText(text).catch(() => {})
  }

  // Radix only opens on the contextmenu event, which browsers do not reliably send for the
  // keyboard, so Shift+F10 and the Menu key send it from the focused element.
  function openFromKeyboard(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return
    e.preventDefault()
    const box = e.currentTarget.getBoundingClientRect()
    e.currentTarget.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 16,
        clientY: box.top + 16,
      }),
    )
  }

  function copyLink() {
    const path = slug
      ? `/w/${slug}/projects/${task.projectId}?task=${task.id}`
      : `${window.location.pathname}?task=${task.id}`
    copy(`${window.location.origin}${path}`)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild onKeyDown={openFromKeyboard}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent aria-label={`Actions for ${task.key}`}>
          <ContextMenuItem onSelect={() => openTask(task.id)}>Open</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>Status</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={task.status}
                onValueChange={(v) => patch({ status: v as TaskStatus })}
              >
                {TASK_STATUSES.map((s) => (
                  <ContextMenuRadioItem key={s} value={s}>
                    <StatusIcon status={s} />
                    {STATUS_LABELS[s]}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Priority</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={task.priority ?? NO_PRIORITY}
                onValueChange={(v) =>
                  patch({ priority: v === NO_PRIORITY ? null : (v as TaskPriority) })
                }
              >
                <ContextMenuRadioItem value={NO_PRIORITY}>
                  <PriorityIcon priority={null} className="size-4" />
                  No priority
                </ContextMenuRadioItem>
                {TASK_PRIORITIES.map((p) => (
                  <ContextMenuRadioItem key={p} value={p}>
                    <PriorityIcon priority={p} className="size-4" />
                    {PRIORITY_LABELS[p]}
                  </ContextMenuRadioItem>
                ))}
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
              <ContextMenuItem onSelect={() => patch({ dueAt: isoDay(0) })}>Today</ContextMenuItem>
              <ContextMenuItem onSelect={() => patch({ dueAt: isoDay(1) })}>
                Tomorrow
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => patch({ dueAt: isoDay(7) })}>
                Next week
              </ContextMenuItem>
              <ContextMenuItem disabled={!task.dueAt} onSelect={() => patch({ dueAt: null })}>
                Clear
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={copyLink}>Copy link</ContextMenuItem>
          <ContextMenuItem onSelect={() => copy(task.key)}>Copy ID</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive-foreground"
            onSelect={() => setConfirmDelete(true)}
          >
            Delete…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          title="Delete task?"
          description={`${task.key} and its subtasks will be permanently removed.`}
        >
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmDelete(false)
                if (taskId === task.id) closeTask()
                del.mutate({ taskId: task.id, projectId: task.projectId })
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
