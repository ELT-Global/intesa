import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { type TaskStatus, type TaskSummary, useUpdateTask } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { STATUS_LABELS, StatusIcon, StatusOptions } from "./properties"
import { TaskKey } from "./task-key"

export type SubtaskSync = {
  task: TaskSummary
  /** The status the task was just moved to. */
  status: TaskStatus
  subtasks: TaskSummary[]
}

/**
 * Asked after a task with subtasks changes status: shows each subtask's state, lets them be set
 * one by one or all to the task's new status. The task itself has already moved.
 */
export function SubtaskSyncDialog({
  sync,
  onClose,
}: {
  sync: SubtaskSync | null
  onClose: () => void
}) {
  // The dialog keeps showing the last request while it animates closed.
  const shown = useRef(sync)
  if (sync) shown.current = sync
  const current = shown.current
  return (
    <Dialog open={sync !== null} onOpenChange={(open) => !open && onClose()}>
      {current && <SyncContent key={current.task.id} sync={current} onClose={onClose} />}
    </Dialog>
  )
}

function SyncContent({ sync, onClose }: { sync: SubtaskSync; onClose: () => void }) {
  const { task, status, subtasks } = sync
  const update = useUpdateTask()
  // Only the subtasks the user has picked a status for.
  const [picked, setPicked] = useState<Record<string, TaskStatus>>({})
  const statusOf = (s: TaskSummary) => picked[s.id] ?? s.status
  const changed = subtasks.filter((s) => statusOf(s) !== s.status)

  function apply() {
    for (const s of changed) {
      update.mutate({
        taskId: s.id,
        projectId: s.projectId,
        parentTaskId: task.id,
        patch: { status: statusOf(s) },
      })
    }
    onClose()
  }

  return (
    <DialogContent
      title="Update subtasks?"
      description={`${task.key} moved to ${STATUS_LABELS[status]}. Choose the state of its subtasks.`}
    >
      <ul className="mb-3 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {subtasks.map((s) => (
          <li key={s.id} className="flex h-9 items-center gap-2 rounded-md px-1">
            <TaskKey>{s.key}</TaskKey>
            <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Status of ${s.title}`}
                  className={cn("text-foreground", statusOf(s) !== s.status && "bg-accent")}
                >
                  <StatusIcon status={statusOf(s)} />
                  {STATUS_LABELS[statusOf(s)]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={statusOf(s)}
                  onValueChange={(v) => setPicked((p) => ({ ...p, [s.id]: v as TaskStatus }))}
                >
                  <StatusOptions Item={DropdownMenuRadioItem} />
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      <Button
        variant="link"
        size="sm"
        disabled={subtasks.every((s) => statusOf(s) === status)}
        onClick={() => setPicked(Object.fromEntries(subtasks.map((s) => [s.id, status])))}
        className="mb-1 px-0"
      >
        Set all to {STATUS_LABELS[status]}
      </Button>
      <DialogFooter>
        <Button size="sm" onClick={onClose}>
          Leave as is
        </Button>
        <Button variant="primary" size="sm" disabled={changed.length === 0} onClick={apply}>
          {changed.length > 0
            ? `Update ${changed.length} ${changed.length === 1 ? "subtask" : "subtasks"}`
            : "Update"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
