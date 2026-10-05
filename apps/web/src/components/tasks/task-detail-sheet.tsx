import * as D from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, Trash2, X } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import {
  relativeTime,
  type TaskDetail,
  taskHistoryQuery,
  taskQuery,
  useDeleteTask,
  useUpdateTask,
} from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { DuePicker, PriorityPicker, STATUS_LABELS, StatusIcon, StatusPicker } from "./properties"
import { TaskErrorNotice } from "./task-error-notice"
import { useTaskParam } from "./task-param"

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
    <>
      <D.Root open={taskId !== null} onOpenChange={(open) => !open && closeTask()}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
          <D.Content
            aria-describedby={undefined}
            className={cn(
              "fixed inset-0 z-40 flex flex-col overflow-hidden bg-background text-foreground outline-none",
              "md:left-auto md:w-[min(40rem,100vw)] md:border-l md:border-border md:shadow-2xl",
            )}
          >
            <D.Title className="sr-only">{task?.key ?? "Task"}</D.Title>
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
                notFound={query.isError}
                loading={query.isPending}
                onClose={closeTask}
              />
            )}
          </D.Content>
        </D.Portal>
      </D.Root>
      <TaskErrorNotice />
    </>
  )
}

function CloseButton() {
  return (
    <D.Close asChild>
      <Button variant="ghost" size="sm" icon aria-label="Close">
        <X />
      </Button>
    </D.Close>
  )
}

function SheetPlaceholder({
  notFound,
  loading,
  onClose,
}: {
  notFound: boolean
  loading: boolean
  onClose: () => void
}) {
  return (
    <>
      <header className="flex min-h-12 items-center border-b border-border px-4">
        <span className="flex-1" />
        <CloseButton />
      </header>
      <div className="p-6 text-sm text-muted-foreground">
        {loading && "Loading task."}
        {notFound && (
          <div className="flex flex-col items-start gap-3">
            <p>This task doesn't exist or was deleted.</p>
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
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
  const update = useUpdateTask()
  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ taskId: task.id, projectId: task.projectId, patch: p })

  return (
    <>
      <header className="flex min-h-12 items-center gap-2 border-b border-border px-4 text-[13px] font-medium text-muted-foreground">
        <span className="text-subtle-foreground">{task.key}</span>
        <span className="flex-1 truncate font-normal">{task.project.name}</span>
        <DeleteTaskButton task={task} onDeleted={onClose} />
        <CloseButton />
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border px-3 py-2">
          <StatusPicker value={task.status} onChange={(status) => patch({ status })} />
          <PriorityPicker value={task.priority} onChange={(priority) => patch({ priority })} />
          <DuePicker
            value={task.dueAt}
            status={task.status}
            onChange={(dueAt) => patch({ dueAt })}
          />
          {propertySlots?.(task)}
        </div>
        <div className="flex flex-col gap-7 p-6">
          <EditableText
            label="Task title"
            value={task.title}
            required
            onCommit={(title) => patch({ title })}
            className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]"
          />
          <EditableText
            label="Description"
            value={task.body ?? ""}
            multiline
            placeholder="Add a description."
            onCommit={(body) => patch({ body: body || null })}
            className="min-h-32 text-[15px] leading-[1.7]"
          />
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

/** Plain text field that saves on blur (and on Enter for single-line). Escape reverts. */
function EditableText({
  label,
  value,
  onCommit,
  multiline,
  required,
  placeholder,
  className,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  multiline?: boolean
  required?: boolean
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Adopt server changes unless the user is mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])

  // Grow the field with its content.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft drives the height
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  function commit() {
    focused.current = false
    const next = draft.trim()
    if ((required && !next) || next === value) {
      setDraft(value)
      return
    }
    setDraft(next)
    onCommit(next)
  }

  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={1}
      value={draft}
      placeholder={placeholder}
      maxLength={multiline ? 20000 : 500}
      onFocus={() => {
        focused.current = true
      }}
      onChange={(e) => setDraft(multiline ? e.target.value : e.target.value.replace(/\n/g, " "))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !multiline) {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === "Escape" && draft !== value) {
          e.stopPropagation()
          setDraft(value)
        }
      }}
      className={cn(
        "-mx-2 w-[calc(100%+1rem)] resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 outline-none transition-colors",
        "placeholder:text-muted-foreground hover:bg-muted/40 focus-visible:border-input focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/24",
        !multiline && "overflow-hidden",
        className,
      )}
    />
  )
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
                    {h.updatedBy.name} · {relativeTime(h.updatedAt)}
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
