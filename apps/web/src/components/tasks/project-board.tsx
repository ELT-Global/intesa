import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { type DragEvent, useState } from "react"
import { Message } from "@/components/page"
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
import { useTaskParam } from "./task-param"

const DRAG_HINT_ID = "kanban-drag-hint"

/** Kanban board: one column per status, cards draggable between columns. */
export function ProjectBoard({ projectId }: { projectId: string }) {
  const tasks = useQuery(projectTasksQuery(projectId))
  const { openTask } = useTaskParam()
  const update = useUpdateTask()
  const [createStatus, setCreateStatus] = useState<TaskStatus | null>(null)

  if (tasks.isError) {
    return <Message title="Couldn't load tasks." body={tasks.error.message} />
  }
  if (!tasks.data) return null
  const all = tasks.data

  function move(taskId: string, status: TaskStatus) {
    const task = all.find((t) => t.id === taskId)
    if (!task || task.status === status) return
    update.mutate({ taskId, projectId, patch: { status } })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p id={DRAG_HINT_ID} className="sr-only">
        Drag to another column to change status, or open the task to change it.
      </p>
      <div className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-xl bg-linear-to-b from-muted/20 to-background [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] md:snap-none">
        <div className="flex h-full w-max min-w-full items-stretch gap-3 p-3">
          {TASK_STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={all.filter((t) => t.status === status)}
              onOpen={openTask}
              onMove={move}
              onAdd={() => setCreateStatus(status)}
            />
          ))}
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

function Column({
  status,
  tasks,
  onOpen,
  onMove,
  onAdd,
}: {
  status: TaskStatus
  tasks: TaskSummary[]
  onOpen: (taskId: string) => void
  onMove: (taskId: string, status: TaskStatus) => void
  onAdd: () => void
}) {
  const [over, setOver] = useState(false)
  const label = STATUS_LABELS[status]

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes("text/plain")) return
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
        const id = e.dataTransfer.getData("text/plain")
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
      <ul className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto p-2 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
        {tasks.map((task) => (
          <li
            key={task.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", task.id)
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
        ))}
      </ul>
      <footer className="border-t border-border/60 p-1.5">
        <Button
          variant="ghost"
          size="xs"
          onClick={onAdd}
          className="w-full justify-start opacity-100 transition-opacity duration-150 md:opacity-0 md:focus-visible:opacity-100 md:group-hover/column:opacity-100"
        >
          <Plus />
          Add task
        </Button>
      </footer>
    </section>
  )
}
