import { styleText } from "node:util"
import {
  dueState,
  formatDay,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "@intesa/task-query"
import type { Env } from "./mode"

export type LineTask = {
  key: string
  title: string
  status: TaskStatus
  priority: TaskPriority | null
  dueAt: string | null
  assignees: readonly { name: string }[]
  tags: readonly { name: string }[]
  subtaskCount: number
  subtaskDoneCount: number
}

export type LineStyle = { color: boolean; unicode: boolean; width: number }

// Legacy Windows consoles (conhost) show boxes for these glyphs; the terminals that render
// them say so through their environment. Elsewhere only the Linux console lacks them.
export function supportsUnicode(env: Env, platform: string = process.platform) {
  if (platform !== "win32") return env.TERM !== "linux"
  return Boolean(
    env.WT_SESSION ||
      env.TERMINUS_SUBLIME ||
      env.ConEmuTask === "{cmd::Cmder}" ||
      env.TERM_PROGRAM === "vscode" ||
      env.TERM_PROGRAM === "Terminus-Sublime" ||
      env.TERMINAL_EMULATOR === "JetBrains-JediTerm" ||
      ["xterm-256color", "alacritty", "rxvt-unicode", "rxvt-unicode-256color"].includes(
        env.TERM ?? "",
      ),
  )
}

const GLYPHS = {
  unicode: {
    status: { backlog: "◌", todo: "○", in_progress: "◐", review: "◉", complete: "●" },
    priority: { urgent: "‼", high: "↑", medium: "=", low: "↓" },
    subtasks: (done: number, total: number) => `${done === total ? "☑" : "☐"} ${done}/${total}`,
    arrow: "→",
  },
  ascii: {
    status: { backlog: "-", todo: "o", in_progress: ">", review: "?", complete: "x" },
    priority: { urgent: "!!", high: "^", medium: "=", low: "v" },
    subtasks: (done: number, total: number) => `[${done}/${total}]`,
    arrow: "->",
  },
} as const

export const glyphs = (style: Pick<LineStyle, "unicode">) =>
  style.unicode ? GLYPHS.unicode : GLYPHS.ascii

type Format = Parameters<typeof styleText>[0]
const paint = (style: LineStyle, format: Format, text: string) =>
  style.color ? styleText(format, text) : text

const STATUS_COLORS: Record<TaskStatus, Format> = {
  backlog: "gray",
  todo: "white",
  in_progress: "yellow",
  review: "magenta",
  complete: "green",
}
const PRIORITY_COLORS: Record<TaskPriority, Format> = {
  urgent: "red",
  high: "yellow",
  medium: "white",
  low: "gray",
}

export const statusText = (status: TaskStatus, style: LineStyle) =>
  `${paint(style, STATUS_COLORS[status], glyphs(style).status[status])} ${STATUS_LABELS[status]}`

export const priorityText = (priority: TaskPriority, style: LineStyle) =>
  paint(
    style,
    PRIORITY_COLORS[priority],
    `${glyphs(style).priority[priority]} ${PRIORITY_LABELS[priority]}`,
  )

// "due today", "due in 3d", "overdue 2d": relative while it is close, a date further out.
export function dueText(dueAt: string, status: TaskStatus, style: LineStyle, now = new Date()) {
  const [y, m, d] = dueAt.split("-").map(Number) as [number, number, number]
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000)
  const text =
    days < 0
      ? `overdue ${-days}d`
      : days === 0
        ? "due today"
        : days === 1
          ? "due tomorrow"
          : days < 14
            ? `due in ${days}d`
            : `due ${formatDay(dueAt, now)}`
  const state = dueState(dueAt, status, now)
  return state === "overdue"
    ? paint(style, "red", text)
    : state === "soon"
      ? paint(style, "yellow", text)
      : text
}

// "@alan" for Alan Owner: short enough for a line, and what `-a alan` matches.
const handle = (name: string) => `@${(name.split(/\s+/)[0] ?? name).toLowerCase()}`

function truncate(text: string, width: number) {
  if (Bun.stringWidth(text) <= width) return text
  return `${Bun.sliceAnsi(text, 0, Math.max(width - 1, 0))}…`
}

const pad = (text: string, width: number) =>
  text + " ".repeat(Math.max(width - Bun.stringWidth(text), 0))

// One line per task, like a board card:
// WEB-12  ◐ In progress  Fix login redirect  ↑ High  @alan @mei  #auth  due in 2d  ☐ 1/3
export function formatTaskLines(tasks: readonly LineTask[], style: LineStyle): string {
  const width = (text: string) => Bun.stringWidth(text)
  const keyWidth = Math.max(0, ...tasks.map((t) => width(t.key)))
  const statusWidth = Math.max(0, ...tasks.map((t) => width(statusText(t.status, style))))
  const metas = tasks.map((t) =>
    [
      t.priority ? priorityText(t.priority, style) : "",
      t.assignees.map((a) => paint(style, "cyan", handle(a.name))).join(" "),
      t.tags.map((g) => paint(style, "blue", `#${g.name}`)).join(" "),
      t.dueAt ? dueText(t.dueAt, t.status, style) : "",
      t.subtaskCount > 0 ? glyphs(style).subtasks(t.subtaskDoneCount, t.subtaskCount) : "",
    ]
      .filter(Boolean)
      .join("  "),
  )
  // Titles share one column so the details line up; it shrinks to fit the widest details.
  const room = style.width - keyWidth - statusWidth - 6 - Math.max(0, ...metas.map(width))
  const titleWidth = Math.max(Math.min(Math.max(0, ...tasks.map((t) => width(t.title))), room), 12)
  return tasks
    .map((t, i) => {
      const key = paint(style, "bold", pad(t.key, keyWidth))
      const status = pad(statusText(t.status, style), statusWidth)
      const meta = metas[i] ?? ""
      const title = truncate(t.title, titleWidth)
      return `${`${key}  ${status}  ${meta ? `${pad(title, titleWidth)}  ${meta}` : title}`.trimEnd()}\n`
    })
    .join("")
}
