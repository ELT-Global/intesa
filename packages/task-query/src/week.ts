import { STATUS_LABELS, type TaskStatus } from "./constants"
import { type DueState, dueState } from "./dates"

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
  /** Open work other than Backlog. */
  pending: number
  backlog: number
  carriedOver: number
  added: number
}

export function weekCounts(
  tasks: readonly { status: TaskStatus; carriedOver: boolean }[],
): WeekCounts {
  const completed = tasks.filter((task) => task.status === "complete").length
  const backlog = tasks.filter((task) => task.status === "backlog").length
  const carriedOver = tasks.filter((task) => task.carriedOver).length
  return {
    total: tasks.length,
    completed,
    pending: tasks.length - completed - backlog,
    backlog,
    carriedOver,
    added: tasks.length - backlog - carriedOver,
  }
}

/** The fields of an API week task that the Markdown needs. */
export type WeekTaskInput = {
  key: string
  title: string
  status: TaskStatus
  completedAt: string | null
  /** YYYY-MM-DD. */
  dueAt: string | null
  /** Subtask progress; null without subtasks. */
  subtasks: { done: number; total: number } | null
  /** Open blockers. */
  blockedBy: { key: string; title: string }[]
  assignedAt: string
  plannedAt: string | null
  carriedOver: boolean
  unassignedAt: string | null
}

/** The date shown as assigned: when it became planned work (left Backlog), else the assignment. */
export const weekTaskAssignedAt = (task: Pick<WeekTaskInput, "assignedAt" | "plannedAt">) =>
  task.plannedAt ?? task.assignedAt

/**
 * How the due date stood at the end of the week (or today, for a week still under way): a task
 * still open past its due day then is overdue. Nothing for a task without a due date.
 */
export function weekDueState(
  task: Pick<WeekTaskInput, "dueAt" | "status">,
  week: string,
  now = new Date(),
): DueState | undefined {
  if (!task.dueAt) return undefined
  const lastDay = new Date(Date.parse(weekBounds(week).to) - 1)
  return dueState(task.dueAt, task.status, now < lastDay ? now : lastDay)
}

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

/** "2 completed · 3 pending · 1 backlog", leaving out zeros; "No tasks" when all are. */
export function weekCountsText(c: WeekCounts): string {
  const parts = [
    c.completed > 0 && `${c.completed} completed`,
    c.pending > 0 && `${c.pending} pending`,
    c.backlog > 0 && `${c.backlog} backlog`,
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

type ReportTask = {
  done: boolean
  key: string
  url?: string
  title: string
  details: string
  /** "WEB-3 Fix the build, API-2 Add limits", while something still blocks it. */
  blockedBy?: string
}
type ReportPerson = {
  name: string
  counts: string
  completed: ReportTask[]
  pending: ReportTask[]
  backlog: ReportTask[]
}
// The week as plain text pieces, which each format below lays out and escapes its own way.
type WeekReport = {
  title: string
  workspace?: string
  counts: string
  people: ReportPerson[]
  idle: string[]
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

function weekReport<T extends WeekTaskInput>(
  log: WeekLogInput<T>,
  opts: WeekLogMarkdownOptions<T>,
): WeekReport {
  const now = opts.now ?? new Date()
  const weekYear = (parseDay(opts.week) ?? now).getFullYear()
  const date = (at: string | Date) => {
    const d = new Date(at)
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: d.getFullYear() === weekYear ? undefined : "numeric",
    })
  }

  const item = (task: T): ReportTask => {
    const done = task.status === "complete"
    const state =
      done && task.completedAt ? `completed ${date(task.completedAt)}` : STATUS_LABELS[task.status]
    const assigned = `assigned ${date(weekTaskAssignedAt(task))}`
    const parts = [state]
    if (task.subtasks) parts.push(`${task.subtasks.done}/${task.subtasks.total} subtasks`)
    const due = task.dueAt && parseDay(task.dueAt)
    if (task.dueAt && due) {
      const overdue = weekDueState(task, opts.week, now) === "overdue"
      parts.push(`due ${date(due)}${overdue ? " (overdue)" : ""}`)
    }
    parts.push(task.carriedOver ? `carried over, ${assigned}` : assigned)
    if (task.unassignedAt) parts.push(`unassigned ${date(task.unassignedAt)}`)
    return {
      done,
      key: task.key,
      url: opts.taskUrl?.(task),
      title: oneLine(task.title),
      details: parts.join(" · "),
      blockedBy: task.blockedBy.length
        ? task.blockedBy.map((b) => `${b.key} ${oneLine(b.title)}`).join(", ")
        : undefined,
    }
  }

  const people = log.people.filter((person) => person.tasks.length > 0)
  return {
    title: `Weekly log · ${formatWeek(opts.week, now)}`,
    workspace: opts.workspace && oneLine(opts.workspace),
    counts: weekCountsText(weekCounts(weekLogTasks(people))),
    people: people.map((person) => ({
      name: oneLine(person.user.name),
      counts: weekCountsText(weekCounts(person.tasks)),
      completed: person.tasks.filter((task) => task.status === "complete").map(item),
      pending: person.tasks
        .filter((task) => task.status !== "complete" && task.status !== "backlog")
        .map(item),
      backlog: person.tasks.filter((task) => task.status === "backlog").map(item),
    })),
    idle: log.people
      .filter((person) => person.member && person.tasks.length === 0)
      .map((person) => oneLine(person.user.name)),
  }
}

/** The whole week as Markdown: what the web page copies and the CLI prints by default. */
export function weekLogMarkdown<T extends WeekTaskInput>(
  log: WeekLogInput<T>,
  opts: WeekLogMarkdownOptions<T>,
): string {
  const report = weekReport(log, opts)
  const line = (task: ReportTask) => {
    const key = escapeMarkdown(task.key)
    const label = task.url ? `[${key}](${linkTarget(task.url)})` : key
    const blocked = task.blockedBy ? `\n  - Blocked by ${escapeMarkdown(task.blockedBy)}` : ""
    return `- [${task.done ? "x" : " "}] ${label} ${escapeMarkdown(task.title)} — ${task.details}${blocked}`
  }
  const workspace = report.workspace ? `${escapeMarkdown(report.workspace)} · ` : ""
  const blocks = [`# ${report.title}`, `${workspace}${report.counts}`]
  for (const person of report.people) {
    blocks.push(`## ${escapeMarkdown(person.name)}`, person.counts)
    if (person.completed.length > 0) {
      blocks.push("**Completed**", person.completed.map(line).join("\n"))
    }
    if (person.pending.length > 0) blocks.push("**Pending**", person.pending.map(line).join("\n"))
    if (person.backlog.length > 0) blocks.push("**Backlog**", person.backlog.map(line).join("\n"))
  }
  if (report.idle.length > 0) {
    blocks.push(`**Nothing this week:** ${report.idle.map(escapeMarkdown).join(", ")}`)
  }
  return `${blocks.join("\n\n")}\n`
}

/**
 * The week in the Markdown subset that also reads right in Slack: *single asterisks* for
 * emphasis, plain `- ` lists, no headings, checkboxes or links (Slack has no escapes, so text
 * is left as written). Each group is its own paragraph so Markdown keeps the line breaks.
 */
export function weekLogSimpleMarkdown<T extends WeekTaskInput>(
  log: WeekLogInput<T>,
  opts: WeekLogMarkdownOptions<T>,
): string {
  const report = weekReport(log, opts)
  const line = (task: ReportTask) => {
    const blocked = task.blockedBy ? `\n  ↳ Blocked by ${task.blockedBy}` : ""
    return `- ${task.key} ${task.title} — ${task.details}${blocked}`
  }
  const list = (title: string, tasks: ReportTask[]) => `_${title}_\n${tasks.map(line).join("\n")}`
  const workspace = report.workspace ? `${report.workspace} · ` : ""
  const blocks = [`*${report.title}*`, `${workspace}${report.counts}`]
  for (const person of report.people) {
    blocks.push(`*${person.name}* · ${person.counts}`)
    if (person.completed.length > 0) blocks.push(list("Completed", person.completed))
    if (person.pending.length > 0) blocks.push(list("Pending", person.pending))
    if (person.backlog.length > 0) blocks.push(list("Backlog", person.backlog))
  }
  if (report.idle.length > 0) blocks.push(`*Nothing this week:* ${report.idle.join(", ")}`)
  return `${blocks.join("\n\n")}\n`
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/**
 * The week as an HTML fragment for pasting as rich text into email and documents. Styles are
 * inline and few, since mail clients drop stylesheets; fonts come from where it is pasted.
 */
export function weekLogHtml<T extends WeekTaskInput>(
  log: WeekLogInput<T>,
  opts: WeekLogMarkdownOptions<T>,
): string {
  const report = weekReport(log, opts)
  const muted = 'style="color:#6b7280"'
  // Mail clients drop form controls, so the checklist is drawn with ballot box characters in a
  // list without bullets, which every client lays out the same way.
  const box = (done: boolean) =>
    `<span style="font-size:15px">${done ? "&#9745;" : "&#9744;"}</span>`
  const item = (task: ReportTask) => {
    const key = escapeHtml(task.key)
    const label = task.url ? `<a href="${escapeHtml(task.url)}">${key}</a>` : key
    const blocked = task.blockedBy
      ? `<br><span style="color:#b91c1c">&#8627; Blocked by ${escapeHtml(task.blockedBy)}</span>`
      : ""
    return `<li style="margin:0 0 6px">${box(task.done)} ${label} ${escapeHtml(task.title)} <span ${muted}>— ${escapeHtml(task.details)}</span>${blocked}</li>`
  }
  const list = (title: string, tasks: ReportTask[]) =>
    tasks.length > 0
      ? [
          `<p><strong>${title}</strong></p>`,
          `<ul style="list-style:none;margin:0 0 12px;padding:0">${tasks.map(item).join("")}</ul>`,
        ]
      : []
  const workspace = report.workspace ? `${escapeHtml(report.workspace)} · ` : ""
  const parts = [
    `<h2>${escapeHtml(report.title)}</h2>`,
    `<p ${muted}>${workspace}${report.counts}</p>`,
  ]
  for (const person of report.people) {
    parts.push(
      `<h3>${escapeHtml(person.name)}</h3>`,
      `<p ${muted}>${person.counts}</p>`,
      ...list("Completed", person.completed),
      ...list("Pending", person.pending),
      ...list("Backlog", person.backlog),
    )
  }
  if (report.idle.length > 0) {
    const names = report.idle.map(escapeHtml).join(", ")
    parts.push(`<p><strong>Nothing this week:</strong> ${names}</p>`)
  }
  return `${parts.join("\n")}\n`
}
