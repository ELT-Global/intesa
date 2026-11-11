import { Chip } from "@/components/ui/badge"
import type { BugStatus } from "@/lib/bugs"
import { cn } from "@/lib/utils"

const STYLES: Record<BugStatus, string> = {
  pending: "border-transparent bg-warning/10 font-medium text-warning-foreground",
  resolved: "border-transparent bg-success/10 font-medium text-success-foreground",
}

const LABELS: Record<BugStatus, string> = { pending: "Pending", resolved: "Resolved" }

/** Pending while any of the bug's tasks is open, resolved once all are complete. */
export function BugStatusBadge({ status, className }: { status: BugStatus; className?: string }) {
  return <Chip className={cn("shrink-0", STYLES[status], className)}>{LABELS[status]}</Chip>
}
