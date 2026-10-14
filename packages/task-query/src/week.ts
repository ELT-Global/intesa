import { STATUS_LABELS, type TaskStatus } from "./constants"

// A week is identified by its Monday as YYYY-MM-DD and runs Monday to Monday in local time.
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (n: number) => String(n).padStart(2, "0")

function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A real calendar day, or undefined for malformed input and days like 2026-02-31. */
function parseDay(day: string): Date | undefined {
  const match = DAY_PATTERN.exec(day)
  if (!match) return undefined
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(y, m - 1, d)
  // Years below 100 would be read as 19xx by the Date constructor.
  date.setFullYear(y)
  const real = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
  return real ? date : undefined
}

function mondayOf(date: Date): Date {
  const sinceMonday = (date.getDay() + 6) % 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday)
}

/** The Monday (local) of the week containing `day`, as YYYY-MM-DD. */
export function weekOf(day: string | Date): string {
  const date = typeof day === "string" ? (parseDay(day) ?? new Date(Number.NaN)) : day
  return localDay(mondayOf(date))
}

/** The Monday `by` weeks after `week`; negative goes back. */
export function shiftWeek(week: string, by: number): string {
  const monday = parseDay(week) ?? new Date(Number.NaN)
  return localDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + by * 7))
}

/** Local midnight on `week`'s Monday and on the next Monday, as ISO instants. */
export function weekBounds(week: string): { from: string; to: string } {
  const monday = parseDay(week) ?? new Date(Number.NaN)
  const [y, m, d] = [monday.getFullYear(), monday.getMonth(), monday.getDate()]
  return {
    from: new Date(y, m, d).toISOString(),
    to: new Date(y, m, d + 7).toISOString(),
  }
}

/** "this", "last", "next" or any YYYY-MM-DD day, as the Monday of its week. */
export function parseWeek(input: string, now = new Date()): string | undefined {
  const text = input.trim().toLowerCase()
  const current = weekOf(now)
  if (text === "this") return current
  if (text === "last") return shiftWeek(current, -1)
  if (text === "next") return shiftWeek(current, 1)
  const day = parseDay(text)
  return day ? weekOf(day) : undefined
}

const monthDay = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric" })

/** "Oct 12 – 18, 2026", "Sep 28 – Oct 4, 2026" or "Dec 28, 2026 – Jan 3, 2027". */
export function formatWeek(week: string, _now = new Date()): string {
  const monday = parseDay(week)
  if (!monday) return week
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  const year = sunday.getFullYear()
  if (monday.getFullYear() !== year) {
    return `${monthDay(monday)}, ${monday.getFullYear()} – ${monthDay(sunday)}, ${year}`
  }
  if (monday.getMonth() !== sunday.getMonth()) {
    return `${monthDay(monday)} – ${monthDay(sunday)}, ${year}`
  }
  return `${monthDay(monday)} – ${sunday.getDate()}, ${year}`
}

export type WeekCounts = {
  total: number
  completed: number
  pending: number
  carriedOver: number
  added: number
}

export function weekCounts(
  tasks: readonly { status: TaskStatus; carriedOver: boolean }[],
): WeekCounts {
  const completed = tasks.filter((task) => task.status === "complete").length
  const carriedOver = tasks.filter((task) => task.carriedOver).length
  return {
    total: tasks.length,
    completed,
    pending: tasks.length - completed,
    carriedOver,
    added: tasks.length - carriedOver,
  }
}

/** The fields of an API week task that the Markdown needs. */
export type WeekTaskInput = {
  key: string
  title: string
  status: TaskStatus
  completedAt: string | null
  assignedAt: string
  plannedAt: string | null
  carriedOver: boolean
  unassignedAt: string | null
}

/** The date shown as assigned: when it became planned work (left Backlog), else the assignment. */
export const weekTaskAssignedAt = (task: Pick<WeekTaskInput, "assignedAt" | "plannedAt">) =>
  task.plannedAt ?? task.assignedAt

export type WeekPersonInput<T extends WeekTaskInput = WeekTaskInput> = {
  user: { name: string }
  member: boolean
  tasks: T[]
}

export type WeekLogInput<T extends WeekTaskInput = WeekTaskInput> = {
  people: WeekPersonInput<T>[]
}

export type WeekLogMarkdownOptions<T extends WeekTaskInput = WeekTaskInput> = {
  /** The Monday of the week, YYYY-MM-DD. */
  week: string
  workspace?: string
  /** Makes the task key a link. */
  taskUrl?: (task: T) => string
  now?: Date
}

function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\[\]*_`]/g, "\\$&")
    .replace(/^#/, "\\#")
}

function linkTarget(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20")
}

/** "2 completed · 3 pending", leaving out a zero ("1 pending"); "No tasks" when both are. */
export function weekCountsText(c: WeekCounts): string {
  const parts = [
    c.completed > 0 && `${c.completed} completed`,
    c.pending > 0 && `${c.pending} pending`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : "No tasks"
}

/**
 * Every task in the week once, though several people may share it (the first listing wins),
 * so totals count tasks rather than assignments.
 */
export function weekLogTasks<T extends WeekTaskInput>(people: readonly WeekPersonInput<T>[]): T[] {
  const seen = new Set<string>()
  return people.flatMap((person) =>
    person.tasks.filter((task) => !seen.has(task.key) && Boolean(seen.add(task.key))),
  )
}

/** The whole week as Markdown: the text the web page copies and the CLI prints. */
export function weekLogMarkdown<T extends WeekTaskInput>(
  log: WeekLogInput<T>,
  opts: WeekLogMarkdownOptions<T>,
): string {
  const now = opts.now ?? new Date()
  const weekYear = (parseDay(opts.week) ?? now).getFullYear()
  const date = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: d.getFullYear() === weekYear ? undefined : "numeric",
    })
  }

  const line = (task: T) => {
    const done = task.status === "complete"
    const key = escapeMarkdown(task.key)
    const url = opts.taskUrl?.(task)
    const label = url ? `[${key}](${linkTarget(url)})` : key
    const state =
      done && task.completedAt ? `completed ${date(task.completedAt)}` : STATUS_LABELS[task.status]
    const assigned = `assigned ${date(weekTaskAssignedAt(task))}`
    const parts = [state, task.carriedOver ? `carried over, ${assigned}` : assigned]
    if (task.unassignedAt) parts.push(`unassigned ${date(task.unassignedAt)}`)
    return `- [${done ? "x" : " "}] ${label} ${escapeMarkdown(task.title)} — ${parts.join(" · ")}`
  }

  const people = log.people.filter((person) => person.tasks.length > 0)
  const idle = log.people.filter((person) => person.member && person.tasks.length === 0)
  const all = weekCounts(weekLogTasks(people))
  const workspace = opts.workspace ? `${escapeMarkdown(opts.workspace)} · ` : ""

  const blocks = [
    `# Weekly log · ${formatWeek(opts.week, now)}`,
    `${workspace}${weekCountsText(all)}`,
  ]
  for (const person of people) {
    blocks.push(`## ${escapeMarkdown(person.user.name)}`)
    blocks.push(weekCountsText(weekCounts(person.tasks)))
    const completed = person.tasks.filter((task) => task.status === "complete")
    const pending = person.tasks.filter((task) => task.status !== "complete")
    if (completed.length > 0) blocks.push("**Completed**", completed.map(line).join("\n"))
    if (pending.length > 0) blocks.push("**Pending**", pending.map(line).join("\n"))
  }
  if (idle.length > 0) {
    const names = idle.map((person) => escapeMarkdown(person.user.name)).join(", ")
    blocks.push(`**Nothing this week:** ${names}`)
  }
  return `${blocks.join("\n\n")}\n`
}
