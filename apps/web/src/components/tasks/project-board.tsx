import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import {
  type DragEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ErrorState } from "@/components/page"
import { Skeleton } from "@/components/skeleton"
import { CountBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  projectTasksQuery,
  TASK_STATUSES,
  type TaskStatus,
  type TaskSummary,
  useUpdateTask,
} from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { CreateTaskDialog } from "./create-task-dialog"
import { STATUS_LABELS, StatusIcon } from "./properties"
import { TaskCard } from "./task-card"
import { TaskContextMenu } from "./task-context-menu"
import { useTaskParam } from "./task-param"
import { CARD_DRAG_TYPE, useDragAutoScroll } from "./use-drag-auto-scroll"

const DRAG_HINT_ID = "kanban-drag-hint"

/** Kanban board: one column per status; cards move by drag and drop or Alt+Left/Right. */
export function ProjectBoard({ projectId }: { projectId: string }) {
  const tasks = useQuery(projectTasksQuery(projectId))
  const { openTask } = useTaskParam()
  const { mutate } = useUpdateTask()
  const autoScroll = useDragAutoScroll()
  const [createStatus, setCreateStatus] = useState<TaskStatus | null>(null)
  const all = tasks.data
  const byStatus = useMemo(() => {
    const groups = new Map<TaskStatus, TaskSummary[]>(TASK_STATUSES.map((s) => [s, []]))
    for (const t of all ?? []) groups.get(t.status)?.push(t)
    return groups
  }, [all])

  // Moving a card re-parents its element, so focus is put back once the new column renders.
  const focusAfterMove = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every list change
  useEffect(() => {
    const id = focusAfterMove.current
    if (!id) return
    focusAfterMove.current = null
    document.querySelector<HTMLElement>(`[data-task-id="${id}"] button`)?.focus()
  }, [all])

  const tasksRef = useRef(all)
  tasksRef.current = all
  const move = useCallback(
    (taskId: string, status: TaskStatus) => {
      const task = tasksRef.current?.find((t) => t.id === taskId)
      if (!task || task.status === status) return
      mutate({ taskId, projectId, patch: { status } })
    },
    [mutate, projectId],
  )
  const [announcement, setAnnouncement] = useState("")
  const moveBy = useCallback(
    (taskId: string, delta: -1 | 1) => {
      const task = tasksRef.current?.find((t) => t.id === taskId)
      if (!task) return
      const next = TASK_STATUSES[TASK_STATUSES.indexOf(task.status) + delta]
      if (!next) {
        setAnnouncement(
          `${task.title} is already in ${STATUS_LABELS[task.status]}, the ${delta < 0 ? "first" : "last"} column`,
        )
        return
      }
      focusAfterMove.current = taskId
      setAnnouncement(`${task.title} moved to ${STATUS_LABELS[next]}`)
      move(taskId, next)
    },
    [move],
  )
  const addTo = useCallback((status: TaskStatus) => setCreateStatus(status), [])

  if (tasks.isError) {
    return <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p id={DRAG_HINT_ID} className="sr-only">
        Drag to another column, or press Alt with the left or right arrow key, to change status. You
        can also open the task to change it.
      </p>
      <div
        ref={autoScroll.canvas}
        data-testid="board-canvas"
        {...autoScroll.handlers}
        className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-xl bg-linear-to-b from-muted/20 to-background [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] md:snap-none"
      >
        <div className="flex h-full w-max min-w-full items-stretch gap-3 p-3">
          {TASK_STATUSES.map((status) =>
            all ? (
              <Column
                key={status}
                status={status}
                tasks={byStatus.get(status) ?? []}
                onOpen={openTask}
                onMove={move}
                onMoveBy={moveBy}
                onAdd={addTo}
              />
            ) : (
              <ColumnShell key={status} status={status} />
            ),
          )}
        </div>
      </div>
      <CreateTaskDialog
        projectId={projectId}
        open={createStatus !== null}
        onOpenChange={(open) => !open && setCreateStatus(null)}
        defaultStatus={createStatus ?? undefined}
      />
    </div>
  )
}

/** Column placeholder shown while tasks load. */
function ColumnShell({ status }: { status: TaskStatus }) {
  const label = STATUS_LABELS[status]
  return (
    <section
      aria-label={label}
      aria-busy
      className="flex w-[85vw] shrink-0 snap-center flex-col rounded-xl border border-border/70 bg-muted/40 shadow-xs/5 md:w-auto md:min-w-68 md:max-w-80 md:flex-1 md:snap-align-none dark:bg-card/90"
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <StatusIcon status={status} />
        <h2 className="text-sm font-medium">{label}</h2>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2">
        <Skeleton className="h-20 w-full bg-background" />
        <Skeleton className="h-16 w-full bg-background" />
      </div>
    </section>
  )
}

const Column = memo(function Column({
  status,
  tasks,
  onOpen,
  onMove,
  onMoveBy,
  onAdd,
}: {
  status: TaskStatus
  tasks: TaskSummary[]
  onOpen: (taskId: string) => void
  onMove: (taskId: string, status: TaskStatus) => void
  onMoveBy: (taskId: string, delta: -1 | 1) => void
  onAdd: (status: TaskStatus) => void
}) {
  const [over, setOver] = useState(false)
  const label = STATUS_LABELS[status]

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes(CARD_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setOver(true)
  }

  return (
    <section
      aria-label={label}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData(CARD_DRAG_TYPE)
        if (id) onMove(id, status)
      }}
      className={cn(
        "group/column flex w-[85vw] shrink-0 snap-center flex-col md:w-auto md:min-w-68 md:max-w-80 md:flex-1 rounded-xl border border-border/70 bg-muted/40 shadow-xs/5 transition-all duration-300 ease-out hover:border-border/90 md:snap-align-none dark:bg-card/90",
        over && "border-ring bg-muted/70 dark:bg-muted/60",
      )}
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <StatusIcon status={status} />
        <h2 className="text-sm font-medium">{label}</h2>
        <CountBadge>{tasks.length}</CountBadge>
      </header>
      <ul
        data-column-body
        className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto p-2 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
      >
        {tasks.map((task) => (
          <DraggableCard key={task.id} task={task} onOpen={onOpen} onMoveBy={onMoveBy} />
        ))}
      </ul>
      <footer className="border-t border-border/60 p-1.5">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onAdd(status)}
          className="w-full justify-start transition-opacity duration-150 opacity-100 md:pointer-fine:opacity-0 md:pointer-fine:group-hover/column:opacity-100 md:pointer-fine:focus-visible:opacity-100"
        >
          <Plus />
          Add task
        </Button>
      </footer>
    </section>
  )
})

const DraggableCard = memo(function DraggableCard({
  task,
  onOpen,
  onMoveBy,
}: {
  task: TaskSummary
  onOpen: (taskId: string) => void
  onMoveBy: (taskId: string, delta: -1 | 1) => void
}) {
  function onKeyDown(e: KeyboardEvent) {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return
    e.preventDefault()
    onMoveBy(task.id, e.key === "ArrowLeft" ? -1 : 1)
  }

  return (
    // Key handling is delegated from the card button inside.
    <TaskContextMenu task={task}>
      <li
        data-task-id={task.id}
        draggable
        onKeyDown={onKeyDown}
        onDragStart={(e) => {
          e.dataTransfer.setData(CARD_DRAG_TYPE, task.id)
          e.dataTransfer.effectAllowed = "move"
          e.currentTarget.dataset.dragging = ""
        }}
        onDragEnd={(e) => {
          delete e.currentTarget.dataset.dragging
        }}
        className="rounded-lg data-[dragging]:shadow-2xl data-[dragging]:ring-1 data-[dragging]:ring-black/5"
      >
        <TaskCard task={task} onOpen={onOpen} describedBy={DRAG_HINT_ID} />
      </li>
    </TaskContextMenu>
  )
})
