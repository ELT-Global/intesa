import { Chip } from "@/components/ui/badge"
import { type BugState, type BugStatus, bugState } from "@/lib/bugs"
import { cn } from "@/lib/utils"

const STYLES: Record<BugState, string> = {
  pending: "border-transparent bg-warning/10 font-medium text-warning-foreground",
  regressed: "border-transparent bg-destructive/10 font-medium text-destructive-foreground",
  resolved: "border-transparent bg-success/10 font-medium text-success-foreground",
}

type BugLike = { status: BugStatus; regressions?: number }

const bugStateLabel = (bug: BugLike) => {
  const state = bugState(bug)
  return state === "regressed"
    ? `Regressed (${bug.regressions})`
    : state === "pending"
      ? "Pending"
      : "Resolved"
}

/**
 * Pending while any of the bug's tasks is open, resolved once all are complete; a pending bug
 * that was resolved before is regressed, with its count of regression tasks.
 */
export function BugStatusBadge({
  bug,
  className,
}: {
  /** Without `regressions` (a task's bug link) it never shows as regressed. */
  bug: BugLike
  className?: string
}) {
  return (
    <Chip className={cn("shrink-0", STYLES[bugState(bug)], className)}>{bugStateLabel(bug)}</Chip>
  )
}
