import {
  CalendarDays,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Minus,
  X,
} from "lucide-react"
import { type ComponentType, type ReactNode, useEffect, useState } from "react"
import { Chip } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  type DueState,
  dueState,
  formatDay,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks"
import { cn } from "@/lib/utils"

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  review: "Review",
  complete: "Complete",
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
}

// Only "in progress" is a signal; the other statuses are told apart by shape.
const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: "text-muted-foreground",
  todo: "text-muted-foreground",
  in_progress: "text-info-foreground",
  review: "text-muted-foreground",
  complete: "text-muted-foreground",
}

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const cls = cn("size-4 shrink-0", STATUS_COLOR[status], className)
  if (status === "complete") return <CircleCheck aria-hidden className={cls} />
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cls}
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="6" strokeDasharray={status === "backlog" ? "2 2.4" : undefined} />
      {status === "in_progress" && (
        <path d="M8 4a4 4 0 0 1 0 8Z" fill="currentColor" stroke="none" />
      )}
      {status === "review" && <path d="M8 8V4a4 4 0 1 1-4 4Z" fill="currentColor" stroke="none" />}
    </svg>
  )
}

export function PriorityIcon({
  priority,
  className,
}: {
  priority: TaskPriority | null
  className?: string
}) {
  const base = cn("size-3.5 shrink-0", className)
  switch (priority) {
    case "low":
      return <ChevronDown aria-hidden className={cn(base, "text-muted-foreground")} />
    case "medium":
      return <ChevronUp aria-hidden className={cn(base, "text-warning-foreground")} />
    case "high":
      return <ChevronsUp aria-hidden className={cn(base, "text-warning-foreground")} />
    case "urgent":
      return <CircleAlert aria-hidden className={cn(base, "text-destructive-foreground")} />
    default:
      return <Minus aria-hidden className={cn(base, "text-muted-foreground")} />
  }
}

export function PriorityChip({ priority }: { priority: TaskPriority }) {
  return (
    <Chip>
      <PriorityIcon priority={priority} className="size-3" />
      {PRIORITY_LABELS[priority]}
    </Chip>
  )
}

const DUE_CHIP: Record<DueState, string> = {
  neutral: "",
  soon: "border-transparent bg-warning/10 font-medium text-warning-foreground",
  overdue: "border-transparent bg-destructive/10 font-medium text-destructive-foreground",
}

export function DueDateChip({ dueAt, status }: { dueAt: string; status: TaskStatus }) {
  const state = dueState(dueAt, status)
  return (
    <Chip className={DUE_CHIP[state]}>
      <CalendarDays aria-hidden className="size-3" />
      {formatDay(dueAt)}
      {state === "overdue" && <span className="sr-only"> (overdue)</span>}
      {state === "soon" && <span className="sr-only"> (due soon)</span>}
    </Chip>
  )
}

function PickerButton({
  label,
  icon,
  children,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" aria-label={label} className="text-foreground">
        {icon}
        {children}
      </Button>
    </DropdownMenuTrigger>
  )
}

export function StatusPicker({
  value,
  onChange,
}: {
  value: TaskStatus
  onChange: (status: TaskStatus) => void
}) {
  return (
    <DropdownMenu>
      <PickerButton label="Change status" icon={<StatusIcon status={value} />}>
        {STATUS_LABELS[value]}
      </PickerButton>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as TaskStatus)}>
          <StatusOptions Item={DropdownMenuRadioItem} />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Radio item component of a menu (dropdown or context), so the option lists can be shared. */
type RadioItem = ComponentType<{ value: string; children?: ReactNode }>

/** One radio item per status, for use inside a menu's radio group. */
export function StatusOptions({ Item }: { Item: RadioItem }) {
  return TASK_STATUSES.map((s) => (
    <Item key={s} value={s}>
      <StatusIcon status={s} />
      {STATUS_LABELS[s]}
    </Item>
  ))
}

export const NO_PRIORITY = "none"
export const priorityFromValue = (v: string) => (v === NO_PRIORITY ? null : (v as TaskPriority))

/** "No priority" plus one radio item per priority, for use inside a menu's radio group. */
export function PriorityOptions({ Item }: { Item: RadioItem }) {
  return (
    <>
      <Item value={NO_PRIORITY}>
        <PriorityIcon priority={null} className="size-4" />
        No priority
      </Item>
      {TASK_PRIORITIES.map((p) => (
        <Item key={p} value={p}>
          <PriorityIcon priority={p} className="size-4" />
          {PRIORITY_LABELS[p]}
        </Item>
      ))}
    </>
  )
}

export function PriorityPicker({
  value,
  onChange,
}: {
  value: TaskPriority | null
  onChange: (priority: TaskPriority | null) => void
}) {
  return (
    <DropdownMenu>
      <PickerButton label="Change priority" icon={<PriorityIcon priority={value} />}>
        {value ? PRIORITY_LABELS[value] : "No priority"}
      </PickerButton>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value ?? NO_PRIORITY}
          onValueChange={(v) => onChange(priorityFromValue(v))}
        >
          <PriorityOptions Item={DropdownMenuRadioItem} />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Native date input; the value is committed on blur or Enter, never mid-typing. */
export function DuePicker({
  value,
  status,
  onChange,
}: {
  value: string | null
  status: TaskStatus
  onChange: (dueAt: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? "")
  useEffect(() => setDraft(value ?? ""), [value])
  const state = value ? dueState(value, status) : "neutral"

  function commit() {
    const year = Number(draft.slice(0, 4))
    if (draft && draft !== value && year >= 1900 && year <= 2999) onChange(draft)
    else setDraft(value ?? "")
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        aria-label="Due date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
        }}
        className={cn(
          "h-7 rounded-lg border border-input bg-background px-2 text-xs shadow-xs/5 outline-none transition-shadow",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 dark:focus-visible:ring-ring/48",
          !value && "text-muted-foreground",
          state === "soon" && "text-warning-foreground",
          state === "overdue" && "text-destructive-foreground",
        )}
      />
      {value && (
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label="Clear due date"
          onClick={() => onChange(null)}
        >
          <X />
        </Button>
      )}
    </div>
  )
}
