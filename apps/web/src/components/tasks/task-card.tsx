import { ListChecks } from "lucide-react"
import type { ButtonHTMLAttributes } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Chip } from "@/components/ui/badge"
import type { TaskSummary } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { DueDateChip, PriorityChip } from "./properties"

export function TagDot({ name, color }: { name: string; color: string }) {
  return (
    <Chip className="font-medium text-foreground/90">
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: `var(--chart-${TAG_SLOT[color] ?? "ink"})` }}
      />
      {name}
    </Chip>
  )
}

const TAG_SLOT: Record<string, string> = {
  blue: "1",
  orange: "2",
  aqua: "3",
  violet: "4",
  magenta: "5",
}

export function TaskCard({
  task,
  onOpen,
  className,
  ...props
}: {
  task: TaskSummary
  onOpen?: (taskId: string) => void
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  const hasMeta = task.priority || task.subtaskCount > 0 || task.dueAt
  return (
    <button
      type="button"
      onClick={() => onOpen?.(task.id)}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col gap-2 rounded-lg border border-border bg-background p-3 text-left shadow-xs/5 transition-colors hover:bg-muted/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-subtle-foreground">{task.key}</span>
        {task.assignees.length > 0 && (
          <span className="flex -space-x-1">
            {task.assignees.slice(0, 3).map((a) => (
              <Avatar key={a.id} name={a.name} className="border-background" />
            ))}
          </span>
        )}
      </span>
      <span className="line-clamp-2 text-sm font-medium text-foreground">{task.title}</span>
      {task.tags.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {task.tags.map((t) => (
            <TagDot key={t.id} name={t.name} color={t.color} />
          ))}
        </span>
      )}
      {hasMeta && (
        <span className="flex flex-wrap items-center gap-1.5">
          {task.priority && <PriorityChip priority={task.priority} />}
          {task.subtaskCount > 0 && (
            <Chip>
              <ListChecks aria-hidden className="size-3" />
              {task.subtaskDoneCount}/{task.subtaskCount}
              <span className="sr-only"> subtasks done</span>
            </Chip>
          )}
          {task.dueAt && <DueDateChip dueAt={task.dueAt} status={task.status} />}
        </span>
      )}
    </button>
  )
}
