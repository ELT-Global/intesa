import { relativeTime, STATUS_LABELS } from "@intesa/task-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { ArrowUpRight, Bug, ChevronRight, Trash2, X } from "lucide-react"
import { type ReactNode, useState } from "react"
import { BugStatusBadge } from "@/components/bugs/bug-status-badge"
import { ErrorState } from "@/components/page"
import { Skeleton } from "@/components/skeleton"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { ApiError } from "@/lib/api"
import { useDeleteArtifact, useUploadImage } from "@/lib/artifacts"
import {
  type TaskDetail,
  taskHistoryQuery,
  taskQuery,
  useDeleteTask,
  useUpdateTask,
} from "@/lib/tasks"
import { shortDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { DescriptionField, EditableText } from "./editable-fields"
import { DuePicker, PriorityPicker, StatusIcon, StatusPicker } from "./properties"
import { PullRequestsSection } from "./pull-requests"
import { TaskArtifacts } from "./task-artifacts"
import { TaskKey } from "./task-key"
import { useTaskParam } from "./task-param"
import { useStatusChange } from "./use-status-change"

/**
 * Right-hand sheet (full screen on mobile) showing the task named by `?task=`.
 * `propertySlots` renders extra property-strip entries (assignees, tags); `sections`
 * renders extra body sections (subtasks, relationships, custom fields).
 */
export function TaskDetailSheet({
  propertySlots,
  sections,
}: {
  propertySlots?: (task: TaskDetail) => ReactNode
  sections?: (task: TaskDetail) => ReactNode
}) {
  const { taskId, closeTask } = useTaskParam()
  const query = useQuery({ ...taskQuery(taskId ?? ""), enabled: taskId !== null })
  const task = query.data

  return (
    <Sheet open={taskId !== null} onOpenChange={(open) => !open && closeTask()}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        // The sheet's listener runs before any field's own, so a field that uses Escape to cancel
        // its edit marks itself and the sheet leaves the key to it.
        onEscapeKeyDown={(e) => {
          if (e.target instanceof HTMLElement && e.target.matches("[data-keeps-escape]"))
            e.preventDefault()
        }}
        className={cn(
          "z-40 w-full overflow-hidden bg-background text-foreground",
          "md:w-[min(40rem,100vw)] md:border-l md:border-border md:shadow-2xl md:ring-1 md:ring-black/5",
        )}
      >
        <SheetTitle className="sr-only">{task?.key ?? "Task"}</SheetTitle>
        {task ? (
          <SheetBody
            key={task.id}
            task={task}
            onClose={closeTask}
            propertySlots={propertySlots}
            sections={sections}
          />
        ) : (
          <SheetPlaceholder
            error={query.isError ? query.error : null}
            loading={query.isPending}
            onClose={closeTask}
            onRetry={() => void query.refetch()}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function CloseButton() {
  return (
    <SheetClose asChild>
      <Button variant="ghost" size="sm" icon aria-label="Close">
        <X />
      </Button>
    </SheetClose>
  )
}

function SheetPlaceholder({
  error,
  loading,
  onClose,
  onRetry,
}: {
  error: unknown
  loading: boolean
  onClose: () => void
  onRetry: () => void
}) {
  const notFound = error instanceof ApiError && error.status === 404
  return (
    <>
      <header className="flex min-h-12 items-center border-b border-border px-4">
        <span className="flex-1" />
        <CloseButton />
      </header>
      {loading && (
        <div role="status" aria-label="Loading task" className="flex flex-col gap-4 p-6">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {notFound && (
        <div className="flex flex-col items-start gap-3 p-6 text-sm text-muted-foreground">
          <p>This task doesn't exist or was deleted.</p>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
      {!!error && !notFound && <ErrorState error={error} onRetry={onRetry} />}
    </>
  )
}

function SheetBody({
  task,
  onClose,
  propertySlots,
  sections,
}: {
  task: TaskDetail
  onClose: () => void
  propertySlots?: (task: TaskDetail) => ReactNode
  sections?: (task: TaskDetail) => ReactNode
}) {
  const { openTask } = useTaskParam()
  const update = useUpdateTask()
  const changeStatus = useStatusChange()
  const patch = (p: Parameters<typeof update.mutate>[0]["patch"], onError?: () => void) =>
    update.mutate({ taskId: task.id, projectId: task.projectId, patch: p }, { onError })

  return (
    <>
      <header className="flex min-h-12 items-center gap-2 border-b border-border px-4 text-[13px] font-medium text-muted-foreground">
        <TaskKey className="text-xs">{task.key}</TaskKey>
        <span className="flex-1 truncate font-normal">{task.project.name}</span>
        <DeleteTaskButton task={task} onDeleted={onClose} />
        <CloseButton />
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border px-3 py-2">
          <StatusPicker value={task.status} onChange={(status) => changeStatus({ task, status })} />
          <PriorityPicker value={task.priority} onChange={(priority) => patch({ priority })} />
          <DuePicker
            value={task.dueAt}
            status={task.status}
            onChange={(dueAt) => patch({ dueAt })}
          />
          {propertySlots?.(task)}
        </div>
        <div className="flex flex-col gap-7 p-6">
          {task.parent && (
            <button
              type="button"
              onClick={() => task.parent && openTask(task.parent.id)}
              className="-mb-4 flex cursor-pointer items-center gap-1.5 self-start rounded text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Parent: <TaskKey className="text-[inherit]">{task.parent.key}</TaskKey>{" "}
              {task.parent.title}
            </button>
          )}
          {task.bug && <BugLink bug={task.bug} projectId={task.projectId} />}
          <EditableText
            label="Task title"
            value={task.title}
            required
            onCommit={(title, revert) => patch({ title }, revert)}
            className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]"
          />
          <TaskDescription
            key={`body-${task.id}`}
            taskId={task.id}
            value={task.body ?? ""}
            onCommit={(body, revert) => patch({ body: body || null }, revert)}
          />
          <TaskArtifacts key={task.id} taskId={task.id} />
          <PullRequestsSection key={`pr-${task.id}`} task={task} />
          {sections?.(task)}
          <HistorySection taskId={task.id} />
        </div>
      </div>
    </>
  )
}

function DeleteTaskButton({ task, onDeleted }: { task: TaskDetail; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const del = useDeleteTask()
  return (
    <>
      <Button variant="ghost" size="sm" icon aria-label="Delete task" onClick={() => setOpen(true)}>
        <Trash2 />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Delete task?"
          description={`${task.key} and its subtasks will be permanently removed.`}
        >
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setOpen(false)
                onDeleted()
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

/** The bug this task worked on, opening it on the project's Bugs page. */
function BugLink({ bug, projectId }: { bug: NonNullable<TaskDetail["bug"]>; projectId: string }) {
  const { slug } = useParams({ strict: false })
  if (!slug) return null
  return (
    <Link
      to="/w/$slug/projects/$projectId/bugs"
      params={{ slug, projectId }}
      search={{ bug: bug.id }}
      aria-label={`Open bug ${bug.key}`}
      title={`Open bug ${bug.key}: ${bug.title}`}
      className="group -mb-3 flex min-w-0 max-w-full items-center gap-2 self-start rounded-md border border-border bg-muted/30 px-2 py-1 text-left text-xs outline-none transition-colors hover:border-ring/50 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bug className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
      <TaskKey className="shrink-0 text-[inherit] group-hover:underline">{bug.key}</TaskKey>
      <span className="truncate group-hover:underline">{bug.title}</span>
      <BugStatusBadge bug={bug} />
      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </Link>
  )
}

function TaskDescription({
  taskId,
  ...props
}: {
  taskId: string
  value: string
  onCommit: (value: string, revert: () => void) => void
}) {
  const upload = useUploadImage(taskId)
  const removeArtifact = useDeleteArtifact(taskId)
  return <DescriptionField {...props} upload={upload} discard={(id) => removeArtifact.mutate(id)} />
}

function HistorySection({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false)
  const query = useQuery({ ...taskHistoryQuery(taskId), enabled: open })
  return (
    <section className="border-t border-border pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        History
      </button>
      {open && (
        <div className="mt-3">
          {query.isPending && <p className="text-xs text-muted-foreground">Loading history.</p>}
          {query.isError && (
            <p role="alert" className="text-xs text-destructive-foreground">
              Could not load history.
            </p>
          )}
          {query.data && (
            <ul aria-label="History" className="flex flex-col gap-2">
              {query.data.map((h) => (
                <li key={h.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusIcon status={h.toStatus} className="size-3.5" />
                  <span className="text-foreground">
                    {h.fromStatus
                      ? `${STATUS_LABELS[h.fromStatus]} → ${STATUS_LABELS[h.toStatus]}`
                      : `Created as ${STATUS_LABELS[h.toStatus]}`}
                  </span>
                  <span>
                    {h.updatedBy.name} ·{" "}
                    <time dateTime={h.updatedAt} title={shortDate(h.updatedAt)}>
                      {relativeTime(h.updatedAt)}
                    </time>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
