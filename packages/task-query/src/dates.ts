import type { TaskStatus } from "./constants"

// Due dates are calendar days (YYYY-MM-DD) with no time zone, so compare them as local days.
function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

/** Calendar days from today to `day`: 0 for today, 1 for tomorrow, negative when past. */
export function daysUntil(day: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((parseDay(day).getTime() - today.getTime()) / 86_400_000)
}

export type DueState = "neutral" | "soon" | "overdue"

export function dueState(dueAt: string, status: TaskStatus, now = new Date()): DueState {
  if (status === "complete") return "neutral"
  const days = daysUntil(dueAt, now)
  if (days < 0) return "overdue"
  return days <= 2 ? "soon" : "neutral"
}

/** The calendar day `offset` days from `now`, as YYYY-MM-DD. */
export function dayFromToday(offset: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDay(day: string, now = new Date()): string {
  const date = parseDay(day)
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  })
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
]

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(0, "second")
}
