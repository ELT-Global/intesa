import { compareBy, nextSort, type Sort, type SortKey, STATUS_LABELS } from "@intesa/task-query"
import { memo, useCallback, useMemo, useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import {
  tableCell as cell,
  Dash,
  SortHeader,
  tableFirstCell,
  tableRow,
} from "@/components/ui/table"
import { type TaskSummary, useUpdateTask } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import {
  CodeLocationChip,
  codeLocation,
  DueDateChip,
  inPullRequest,
  PriorityChip,
  PriorityPicker,
  PullRequestChip,
  StatusIcon,
  StatusPicker,
} from "./properties"
import { TagDot } from "./tag-chip"
import { TaskContextMenu } from "./task-context-menu"
import { TaskTitle } from "./task-title"
import { useStatusChange } from "./use-status-change"

export type TableTask = TaskSummary & { project?: { id: string; name: string; key: string } }
export type TableColumn = "task" | "project" | "status" | "priority" | "assignees" | "tags" | "due"
export const ALL_COLUMNS: TableColumn[] = ["task", "status", "priority", "assignees", "tags", "due"]

type RowPatch = { status: TaskSummary["status"] } | { priority: TaskSummary["priority"] }

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
            // w-full with max-w-0 hands this column the table's spare width, so titles use
            // what the page gives the table and truncate only once it runs out.
            className={cn(cell, tableFirstCell)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpen(task)
              }}
              data-task-primary
              className="flex w-full min-w-40 cursor-pointer items-baseline gap-2 text-left outline-none focus-visible:underline"
            >
              <span className="shrink-0 whitespace-nowrap font-mono text-[12.5px] text-subtle-foreground">
                {task.key}
              </span>
              <span className="truncate font-medium text-foreground">
                <TaskTitle title={task.title} />
              </span>
            </button>
          </td>
        )
      case "project":
        return (
          <td key={column} className={cn(cell, "whitespace-nowrap text-muted-foreground")}>
            {task.project?.name ?? "—"}
          </td>
        )
      case "status": {
        const location = codeLocation(task)
        return (
          <td key={column} className={cn(cell, "whitespace-nowrap")}>
            <span className="inline-flex items-center gap-2">
              {editable ? (
                <StatusPicker value={task.status} onChange={(status) => patch({ status })} />
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <StatusIcon status={task.status} />
                  {STATUS_LABELS[task.status]}
                </span>
              )}
              {inPullRequest(task) && <PullRequestChip pullRequests={task.pullRequests} />}
              {location && <CodeLocationChip location={location} />}
            </span>
          </td>
        )
      }
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
    <TaskContextMenu task={task}>
      <tr
        onClick={(e) => {
          // Menus render in a portal but still bubble through React; only plain cell clicks open the task.
          const t = e.target as HTMLElement
          if (e.currentTarget.contains(t) && !t.closest("button,input,[role^=menuitem]"))
            onOpen(task)
        }}
        className={tableRow}
      >
        {columns.map(renderCell)}
      </tr>
    </TaskContextMenu>
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
  const changeStatus = useStatusChange()
  const onPatch = useCallback(
    (task: TableTask, patch: RowPatch) =>
      "status" in patch
        ? changeStatus({ task, status: patch.status })
        : update.mutate({ taskId: task.id, projectId: task.projectId, patch }),
    [update.mutate, changeStatus],
  )
  const onSort = (key: SortKey) => setSort((s) => nextSort(s, key))

  return (
    // relative: sr-only text in cells is absolutely positioned and would otherwise escape this scroller and widen the page
    <div className="relative overflow-x-auto">
      <table aria-label={label} className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <SortHeader
                key={c}
                label={HEADERS[c]}
                sortKey={SORTABLE.includes(c) ? (c as SortKey) : undefined}
                sort={sort}
                onSort={onSort}
                first={i === 0}
              />
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
