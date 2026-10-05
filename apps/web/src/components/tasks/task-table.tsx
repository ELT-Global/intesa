import { ChevronDown, ChevronUp } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { TASK_STATUSES, type TaskPriority, type TaskSummary, useUpdateTask } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import {
  DueDateChip,
  PriorityChip,
  PriorityPicker,
  STATUS_LABELS,
  StatusIcon,
  StatusPicker,
} from "./properties"
import { TagDot } from "./tag-chip"

export type TableTask = TaskSummary & { project?: { id: string; name: string; key: string } }
export type TableColumn = "task" | "project" | "status" | "priority" | "assignees" | "tags" | "due"
export const ALL_COLUMNS: TableColumn[] = ["task", "status", "priority", "assignees", "tags", "due"]

type RowPatch = { status: TaskSummary["status"] } | { priority: TaskSummary["priority"] }
type SortKey = "task" | "status" | "priority" | "due"
type Sort = { key: SortKey; dir: "asc" | "desc" }

const HEADERS: Record<TableColumn, string> = {
  task: "Task",
  project: "Project",
  status: "Status",
  priority: "Priority",
  assignees: "Assignees",
  tags: "Tags",
  due: "Due",
}
const SORTABLE: TableColumn[] = ["task", "status", "priority", "due"]
const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

/** Missing values always sort last, whichever direction is active. */
function compareBy(sort: Sort): (a: TableTask, b: TableTask) => number {
  const sign = sort.dir === "asc" ? 1 : -1
  const value = (t: TableTask): string | number | null => {
    switch (sort.key) {
      case "task":
        return t.title.toLowerCase()
      case "status":
        return TASK_STATUSES.indexOf(t.status)
      case "priority":
        return t.priority ? PRIORITY_RANK[t.priority] : null
      case "due":
        return t.dueAt
    }
  }
  return (a, b) => {
    const x = value(a)
    const y = value(b)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return (x < y ? -1 : 1) * sign
  }
}

const cell =
  "h-10 pointer-coarse:h-11 border-b border-border/70 px-4 align-middle group-last/row:border-b-0"

function SortHeader({
  column,
  sort,
  onSort,
  first,
}: {
  column: TableColumn
  sort: Sort | null
  onSort: (key: SortKey) => void
  first: boolean
}) {
  const th = cn(
    "h-9 whitespace-nowrap border-b border-border px-4 text-left text-[12px] font-medium text-muted-foreground",
    first && "sticky left-0 z-10 bg-card",
  )
  if (!SORTABLE.includes(column)) {
    return (
      <th scope="col" className={th}>
        {HEADERS[column]}
      </th>
    )
  }
  const active = sort?.key === column
  const Chevron = active && sort.dir === "desc" ? ChevronDown : ChevronUp
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className={th}
    >
      <button
        type="button"
        onClick={() => onSort(column as SortKey)}
        className={cn(
          "group/sort -mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          active && "text-foreground",
        )}
      >
        {HEADERS[column]}
        <Chevron
          aria-hidden
          className={cn(
            "size-3",
            !active &&
              "opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
          )}
        />
      </button>
    </th>
  )
}

function Dash() {
  return <span className="text-muted-foreground">—</span>
}

const Row = memo(function Row({
  task,
  columns,
  editable,
  onOpen,
  onPatch,
}: {
  task: TableTask
  columns: TableColumn[]
  editable: boolean
  onOpen: (task: TableTask) => void
  onPatch: (task: TableTask, patch: RowPatch) => void
}) {
  const patch = (p: RowPatch) => onPatch(task, p)

  const renderCell = (column: TableColumn) => {
    switch (column) {
      case "task":
        return (
          <td
            key={column}
            className={cn(
              cell,
              "sticky left-0 z-10 bg-card group-hover/row:bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]",
            )}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpen(task)
              }}
              className="flex max-w-80 min-w-40 cursor-pointer items-baseline gap-2 text-left outline-none focus-visible:underline"
            >
              <span className="font-mono text-[12.5px] text-subtle-foreground">{task.key}</span>
              <span className="truncate font-medium text-foreground">{task.title}</span>
            </button>
          </td>
        )
      case "project":
        return (
          <td key={column} className={cn(cell, "whitespace-nowrap text-muted-foreground")}>
            {task.project?.name ?? "—"}
          </td>
        )
      case "status":
        return (
          <td key={column} className={cn(cell, "whitespace-nowrap")}>
            {editable ? (
              <StatusPicker value={task.status} onChange={(status) => patch({ status })} />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <StatusIcon status={task.status} />
                {STATUS_LABELS[task.status]}
              </span>
            )}
          </td>
        )
      case "priority":
        return (
          <td key={column} className={cn(cell, "whitespace-nowrap")}>
            {editable ? (
              <PriorityPicker value={task.priority} onChange={(priority) => patch({ priority })} />
            ) : task.priority ? (
              <PriorityChip priority={task.priority} />
            ) : (
              <Dash />
            )}
          </td>
        )
      case "assignees":
        return (
          <td key={column} className={cell}>
            {task.assignees.length > 0 ? (
              <span className="flex -space-x-1">
                {task.assignees.slice(0, 4).map((a) => (
                  <Avatar key={a.id} name={a.name} className="border-background" />
                ))}
                <span className="sr-only">{task.assignees.map((a) => a.name).join(", ")}</span>
              </span>
            ) : (
              <Dash />
            )}
          </td>
        )
      case "tags":
        return (
          <td key={column} className={cell}>
            {task.tags.length > 0 && (
              <span className="flex items-center gap-1.5">
                {task.tags.slice(0, 2).map((t) => (
                  <TagDot key={t.id} name={t.name} color={t.color} />
                ))}
                {task.tags.length > 2 && (
                  <span className="text-xs text-muted-foreground">+{task.tags.length - 2}</span>
                )}
              </span>
            )}
          </td>
        )
      case "due":
        return (
          <td key={column} className={cn(cell, "whitespace-nowrap")}>
            {task.dueAt && <DueDateChip dueAt={task.dueAt} status={task.status} />}
          </td>
        )
    }
  }

  return (
    <tr
      onClick={(e) => {
        // Menus render in a portal but still bubble through React; only plain cell clicks open the task.
        const t = e.target as HTMLElement
        if (e.currentTarget.contains(t) && !t.closest("button,input,[role^=menuitem]")) onOpen(task)
      }}
      className="group/row cursor-pointer transition-colors hover:bg-muted/40"
    >
      {columns.map(renderCell)}
    </tr>
  )
})

export function TaskTable({
  tasks,
  columns = ALL_COLUMNS,
  editable = true,
  onOpen,
  label,
}: {
  tasks: TableTask[]
  columns?: TableColumn[]
  /** Status and priority become pickers that save through the shared task cache. */
  editable?: boolean
  onOpen: (task: TableTask) => void
  label: string
}) {
  const [sort, setSort] = useState<Sort | null>(null)
  const rows = useMemo(() => (sort ? [...tasks].sort(compareBy(sort)) : tasks), [tasks, sort])

  const update = useUpdateTask()
  const onPatch = useCallback(
    (task: TableTask, patch: RowPatch) =>
      update.mutate({ taskId: task.id, projectId: task.projectId, patch }),
    [update.mutate],
  )
  const onSort = (key: SortKey) =>
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    )

  return (
    // relative: sr-only text in cells is absolutely positioned and would otherwise escape this scroller and widen the page
    <div className="relative overflow-x-auto">
      <table aria-label={label} className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <SortHeader key={c} column={c} sort={sort} onSort={onSort} first={i === 0} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <Row
              key={t.id}
              task={t}
              columns={columns}
              editable={editable}
              onOpen={onOpen}
              onPatch={onPatch}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
