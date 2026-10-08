import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronsLeft, Plus } from "lucide-react"
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
import { assigneeViews, stepAssigneeView } from "@/lib/assignee-views"
import { getBacklogExpanded, setBacklogExpanded } from "@/lib/preferences"
import { membersQuery, projectQuery } from "@/lib/queries"
import { isPlainShortcut, useShortcut } from "@/lib/shortcuts"
import { compileSearch } from "@/lib/task-search"
import {
  type Placement,
  projectTasksQuery,
  TASK_STATUSES,
  type TaskStatus,
  type TaskSummary,
  taskKeys,
  useUpdateTask,
} from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { AssigneeFilter, UNASSIGNED } from "./assignee-filter"
import { CreateTaskDialog } from "./create-task-dialog"
import { STATUS_LABELS, StatusIcon } from "./properties"
import { TaskCard } from "./task-card"
import { TaskContextMenu } from "./task-context-menu"
import { useTaskParam } from "./task-param"
import { TaskSearch } from "./task-search"
import { useBoardAssigneeFilter } from "./use-board-assignee-filter"
import { CARD_DRAG_TYPE, useDragAutoScroll } from "./use-drag-auto-scroll"

const DRAG_HINT_ID = "kanban-drag-hint"

/**
 * Kanban board: one column per status. Cards move between columns by drag and drop or
 * Alt+Left/Right, and are reordered within a column by drag and drop or Alt+Up/Down.
 */
export function ProjectBoard({ projectId }: { projectId: string }) {
  const tasks = useQuery(projectTasksQuery(projectId))
  const { openTask } = useTaskParam()
  const { mutate } = useUpdateTask()
  const autoScroll = useDragAutoScroll()
  const [createStatus, setCreateStatus] = useState<TaskStatus | null>(null)
  const all = tasks.data
  const workspaceId = useQuery(projectQuery(projectId)).data?.workspaceId
  const {
    selected: assigneeIds,
    ready: filterReady,
    meId,
    select: setPicked,
  } = useBoardAssigneeFilter(projectId, workspaceId)
  const members = useQuery({ ...membersQuery(workspaceId ?? ""), enabled: !!workspaceId })
  // Shift+Arrow steps through the assignee views, once the filter and the members are known.
  const stepView = (delta: -1 | 1) => {
    if (!filterReady || !members.data) return
    const views = assigneeViews(
      meId,
      members.data.map((m) => m.userId),
      UNASSIGNED,
    )
    setPicked(stepAssigneeView(views, assigneeIds, delta))
  }
  useShortcut(
    (e) => isPlainShortcut(e, "ArrowLeft", { shift: true }),
    () => stepView(-1),
  )
  useShortcut(
    (e) => isPlainShortcut(e, "ArrowRight", { shift: true }),
    () => stepView(1),
  )
  const [query, setQuery] = useState("")
  const matchesQuery = useMemo(() => compileSearch(query, { meId }), [query, meId])
  const shown = useCallback(
    (t: TaskSummary) =>
      (assigneeIds.length === 0 ||
        (t.assignees.length === 0
          ? assigneeIds.includes(UNASSIGNED)
          : t.assignees.some((a) => assigneeIds.includes(a.id)))) &&
      (!matchesQuery || matchesQuery(t)),
    [assigneeIds, matchesQuery],
  )
  // Backlog is out of the way until asked for; the choice is remembered across visits.
  const [backlogOpen, setBacklogOpen] = useState(getBacklogExpanded)
  const toggleBacklog = useCallback((open: boolean) => {
    setBacklogOpen(open)
    setBacklogExpanded(open)
  }, [])
  const byStatus = useMemo(() => {
    const groups = new Map<TaskStatus, TaskSummary[]>(TASK_STATUSES.map((s) => [s, []]))
    for (const t of all ?? []) if (shown(t)) groups.get(t.status)?.push(t)
    return groups
  }, [all, shown])

  // Moving a card re-parents its element, so focus is put back once the new column renders.
  const focusAfterMove = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every list change
  useEffect(() => {
    const id = focusAfterMove.current
    if (!id) return
    focusAfterMove.current = null
    document.querySelector<HTMLElement>(`[data-task-id="${id}"] button`)?.focus()
  }, [all])

  // Moves read the cache, not what was last rendered: an optimistic update lands there at
  // once, but the next render can come later than the next key press of a held shortcut.
  const qc = useQueryClient()
  const currentTasks = useCallback(
    () => qc.getQueryData<TaskSummary[]>(taskKeys.list(projectId)),
    [qc, projectId],
  )
  const shownRef = useRef(shown)
  shownRef.current = shown
  const move = useCallback(
    (taskId: string, status: TaskStatus, placement?: Placement) => {
      const list = currentTasks()
      const task = list?.find((t) => t.id === taskId)
      if (!list || !task) return
      if (task.status === status) {
        if (!placement || isInPlace(list, task, placement)) return
        mutate({ taskId, projectId, patch: { placement } })
        return
      }
      mutate({ taskId, projectId, patch: { status, ...(placement && { placement }) } })
    },
    [mutate, projectId, currentTasks],
  )
  const [announcement, setAnnouncement] = useState("")
  const moveBy = useCallback(
    (taskId: string, delta: -1 | 1) => {
      const task = currentTasks()?.find((t) => t.id === taskId)
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
    [move, currentTasks],
  )
  const moveWithin = useCallback(
    (taskId: string, delta: -1 | 1) => {
      const list = currentTasks()
      const task = list?.find((t) => t.id === taskId)
      if (!list || !task) return
      // The visible cards only: with a filter on, a card passes the ones that are hidden.
      const visible = list.filter((t) => t.status === task.status && shownRef.current(t))
      const at = visible.findIndex((t) => t.id === taskId)
      const next = visible[at + delta]
      if (!next) {
        setAnnouncement(
          `${task.title} is already the ${delta < 0 ? "first" : "last"} card in ${STATUS_LABELS[task.status]}`,
        )
        return
      }
      focusAfterMove.current = taskId
      setAnnouncement(
        `${task.title} moved to position ${at + delta + 1} of ${visible.length} in ${STATUS_LABELS[task.status]}`,
      )
      move(taskId, task.status, delta < 0 ? { before: next.id } : { after: next.id })
    },
    [move, currentTasks],
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
        Drag to another column, or press Alt with the left or right arrow key, to change status.
        Drag within a column, or press Alt with the up or down arrow key, to change its order. You
        can also open the task to change its status.
      </p>
      <div className="mb-2 flex items-center gap-2">
        <div title="Switch assignee view (Shift + ← / →)">
          <AssigneeFilter
            workspaceId={workspaceId}
            selected={assigneeIds}
            meId={meId}
            onChange={setPicked}
          />
        </div>
        <TaskSearch query={query} onChange={setQuery} tasks={all ?? []} />
      </div>
      <div
        ref={autoScroll.canvas}
        data-testid="board-canvas"
        {...autoScroll.handlers}
        className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-xl bg-linear-to-b from-muted/20 to-background [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] md:snap-none"
      >
        <div className="flex h-full w-max min-w-full items-stretch gap-3 p-3">
          {TASK_STATUSES.map((status) => {
            if (!all || !filterReady) return <ColumnShell key={status} status={status} />
            const columnTasks = byStatus.get(status) ?? []
            if (status === "backlog" && !backlogOpen) {
              return (
                <BacklogRail
                  key={status}
                  count={columnTasks.length}
                  onExpand={() => toggleBacklog(true)}
                />
              )
            }
            return (
              <Column
                key={status}
                status={status}
                tasks={columnTasks}
                onOpen={openTask}
                onMove={move}
                onMoveBy={moveBy}
                onMoveWithin={moveWithin}
                onAdd={addTo}
                onCollapse={status === "backlog" ? () => toggleBacklog(false) : undefined}
              />
            )
          })}
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

/** True when `placement` would leave `task` where it already is in its column. */
function isInPlace(list: TaskSummary[], task: TaskSummary, placement: Placement) {
  const column = list.filter((t) => t.status === task.status && !t.parentTaskId)
  const at = column.findIndex((t) => t.id === task.id)
  if (placement === "first") return at === 0
  if (placement === "last") return at === column.length - 1
  if ("before" in placement) {
    return placement.before === task.id || column[at + 1]?.id === placement.before
  }
  return placement.after === task.id || column[at - 1]?.id === placement.after
}

/** Where a card dropped at `clientY` lands among the cards of a column, and where to draw it. */
function dropTarget(body: HTMLElement, clientY: number): { placement?: Placement; top: number } {
  // The card being dragged is skipped: the others close up around the gap it leaves.
  const cards = [...body.querySelectorAll<HTMLElement>(":scope > li[data-task-id]")].filter(
    (li) => !li.hasAttribute("data-dragging"),
  )
  const index = cards.filter((li) => {
    const box = li.getBoundingClientRect()
    return clientY > box.top + box.height / 2
  }).length
  const origin = body.getBoundingClientRect().top - body.scrollTop
  const next = cards[index]
  const previous = cards[index - 1]
  // Halfway through the gap (gap-2 is 8px) between the cards on either side.
  const top = next
    ? next.getBoundingClientRect().top - origin - 4
    : previous
      ? previous.getBoundingClientRect().bottom - origin + 4
      : 0
  const placement: Placement | undefined = next?.dataset.taskId
    ? { before: next.dataset.taskId }
    : previous?.dataset.taskId
      ? { after: previous.dataset.taskId }
      : undefined
  return { placement, top }
}

/** The collapsed Backlog column: a slim rail that opens it again. */
function BacklogRail({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={false}
      aria-label={`Show Backlog, ${count} ${count === 1 ? "task" : "tasks"}`}
      className="flex w-9 shrink-0 cursor-pointer flex-col items-center gap-2.5 rounded-xl border border-border/70 bg-muted/40 py-3 outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring dark:bg-card/90"
    >
      <StatusIcon status="backlog" />
      <CountBadge>{count}</CountBadge>
      <span className="text-[13px] font-medium [writing-mode:vertical-rl]">
        {STATUS_LABELS.backlog}
      </span>
    </button>
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
  onMoveWithin,
  onAdd,
  onCollapse,
}: {
  status: TaskStatus
  tasks: TaskSummary[]
  onOpen: (taskId: string) => void
  onMove: (taskId: string, status: TaskStatus, placement?: Placement) => void
  onMoveBy: (taskId: string, delta: -1 | 1) => void
  onMoveWithin: (taskId: string, delta: -1 | 1) => void
  onAdd: (status: TaskStatus) => void
  /** Set for a column that can fold away into a rail. */
  onCollapse?: () => void
}) {
  const [over, setOver] = useState(false)
  // Offset of the drop line inside the card list while a card is dragged over the column.
  const [lineTop, setLineTop] = useState<number | null>(null)
  const body = useRef<HTMLUListElement>(null)
  const label = STATUS_LABELS[status]

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes(CARD_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setOver(true)
    if (body.current) setLineTop(dropTarget(body.current, e.clientY).top)
  }

  return (
    <section
      aria-label={label}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOver(false)
          setLineTop(null)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        setLineTop(null)
        const id = e.dataTransfer.getData(CARD_DRAG_TYPE)
        if (!id) return
        const target = body.current ? dropTarget(body.current, e.clientY) : undefined
        onMove(id, status, target?.placement)
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
        {onCollapse && (
          <Button
            variant="ghost"
            size="xs"
            icon
            aria-label={`Hide ${label}`}
            onClick={onCollapse}
            className="ml-auto"
          >
            <ChevronsLeft />
          </Button>
        )}
      </header>
      <ul
        ref={body}
        data-column-body
        className="relative flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto p-2 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
      >
        {tasks.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            onOpen={onOpen}
            onMoveBy={onMoveBy}
            onMoveWithin={onMoveWithin}
          />
        ))}
        {lineTop !== null && tasks.length > 0 && (
          <li
            aria-hidden
            data-drop-line
            style={{ top: lineTop }}
            className="pointer-events-none absolute inset-x-2 h-0.5 -translate-y-1/2 rounded-full bg-ring"
          />
        )}
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
  onMoveWithin,
}: {
  task: TaskSummary
  onOpen: (taskId: string) => void
  onMoveBy: (taskId: string, delta: -1 | 1) => void
  onMoveWithin: (taskId: string, delta: -1 | 1) => void
}) {
  function onKeyDown(e: KeyboardEvent) {
    if (!e.altKey) return
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault()
      onMoveBy(task.id, e.key === "ArrowLeft" ? -1 : 1)
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      onMoveWithin(task.id, e.key === "ArrowUp" ? -1 : 1)
    }
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
