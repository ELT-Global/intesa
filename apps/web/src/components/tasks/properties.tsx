import {
  type DueState,
  dueState,
  formatDay,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@intesa/task-query"
import {
  CalendarDays,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
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
import type { PullRequestRef } from "@/lib/tasks"
import { cn } from "@/lib/utils"

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

type PullRequestState = NonNullable<PullRequestRef["state"]>

export const PULL_REQUEST_LABELS: Record<PullRequestState, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
}

const PULL_REQUEST_ICONS: Record<PullRequestState, typeof GitPullRequest> = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
}

const PULL_REQUEST_COLOR: Record<PullRequestState, string> = {
  open: "text-success-foreground",
  draft: "text-muted-foreground",
  merged: "text-info-foreground",
  closed: "text-muted-foreground",
}

/** A PR whose state is not known yet (GitHub has not told us) shows as open. */
export function PullRequestIcon({
  state,
  className,
}: {
  state: PullRequestRef["state"]
  className?: string
}) {
  const known = state ?? "open"
  const Icon = PULL_REQUEST_ICONS[known]
  return (
    <Icon aria-hidden className={cn("size-3.5 shrink-0", PULL_REQUEST_COLOR[known], className)} />
  )
}

/** The state that says most about where a task's PRs are: one still open outweighs the rest. */
function overallState(pullRequests: PullRequestRef[]): PullRequestState {
  const states = new Set(pullRequests.map((p) => p.state ?? "open"))
  if (states.has("open")) return "open"
  if (states.has("draft")) return "draft"
  if (states.has("merged")) return "merged"
  return "closed"
}

const PULL_REQUEST_CHIP: Record<PullRequestState, string> = {
  open: "border-transparent bg-success/10 font-medium text-success-foreground",
  draft: "",
  merged: "border-transparent bg-info/10 font-medium text-info-foreground",
  closed: "",
}

/** Whether a task shows "In PR": it is being worked on and has a pull request. */
export const inPullRequest = (task: { status: TaskStatus; pullRequests: PullRequestRef[] }) =>
  task.status === "in_progress" && task.pullRequests.length > 0

/** "In PR" on a task being worked on whose code is in a pull request. */
export function PullRequestChip({ pullRequests }: { pullRequests: PullRequestRef[] }) {
  const state = overallState(pullRequests)
  const title = pullRequests
    .map((p) => `#${p.number} ${PULL_REQUEST_LABELS[p.state ?? "open"].toLowerCase()}`)
    .join(", ")
  return (
    <Chip className={PULL_REQUEST_CHIP[state]} title={title}>
      <PullRequestIcon state={state} className="size-3 text-current" />
      In PR
      <span className="sr-only"> ({title})</span>
    </Chip>
  )
}

/** Where a merged PR's code is: the production branch once found there, else its base. */
const prLocation = (pr: PullRequestRef) => pr.releasedTo ?? pr.baseBranch ?? "?"

type CodeLocation = { branch: string; released: boolean; merged: PullRequestRef[] }

/**
 * Where a reviewed or completed task's code is, from its merged PRs: the production branch
 * (main) once all of them are found there, else the branch the first of the rest merged into.
 */
export function codeLocation(task: {
  status: TaskStatus
  pullRequests: PullRequestRef[]
}): CodeLocation | null {
  if (task.status !== "review" && task.status !== "complete") return null
  const merged = task.pullRequests.filter((p) => p.state === "merged")
  const pending = merged.find((p) => !p.releasedTo)
  const first = pending ?? merged[0]
  if (!first) return null
  return { branch: prLocation(first), released: !pending, merged }
}

/** "In qa" or "In main" on a task whose PRs have merged. */
export function CodeLocationChip({ location }: { location: CodeLocation }) {
  const title = location.merged.map((p) => `#${p.number} in ${prLocation(p)}`).join(", ")
  return (
    <Chip
      className={cn(
        "border-transparent font-medium",
        location.released
          ? "bg-success/10 text-success-foreground"
          : "bg-info/10 text-info-foreground",
      )}
      title={title}
    >
      <GitMerge aria-hidden className="size-3" />
      In {location.branch}
      <span className="sr-only"> ({title})</span>
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
