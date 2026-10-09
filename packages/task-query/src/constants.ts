export type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "complete"
export type TaskPriority = "low" | "medium" | "high" | "urgent"

/** In board order, left to right. */
export const TASK_STATUSES: readonly TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "complete",
]
export const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"]

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

/** Sort position of a priority; the most urgent comes first. */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
}
