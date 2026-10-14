// What every part of the view draws with: the theme, styled text, the focus fill, panels.
import {
  dueState,
  type IntentHue,
  STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
  titleIntent,
} from "@intesa/task-query"
import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core"
import { dueText, glyphs, type Task } from "../api"
import type { Store } from "../store"
import { type Line, type Seg, styled, truncate } from "../text"

export type Ui = { unicode: boolean; color: boolean }

export const THEME = {
  muted: "#8b949e",
  accent: "#58a6ff",
  focusBg: "#253247",
  border: "#3d444d",
  overlayBg: "#14171c",
  person: "#39c5cf",
  tag: "#79c0ff",
  error: "#f85149",
  ok: "#3fb950",
  warn: "#e3b341",
  status: {
    backlog: "#8b949e",
    todo: "#c9d1d9",
    in_progress: "#e3b341",
    review: "#bc8cff",
    complete: "#3fb950",
  } as Record<TaskStatus, string>,
  // Amber for medium and high, as on the web.
  priority: { urgent: "#f85149", high: "#e3b341", medium: "#e3b341", low: "#8b949e" },
  // The `type(scope):` that opens a conventional commit style title.
  intent: {
    green: "#3fb950",
    red: "#ff7b72",
    blue: "#6cb6ff",
    violet: "#bc8cff",
    orange: "#f0883e",
    pink: "#f778ba",
    cyan: "#56d4dd",
    yellow: "#e3b341",
    indigo: "#a5b4fc",
    lime: "#a5d64b",
    gray: "#8b949e",
  } as Record<IntentHue, string>,
}

/** A title as segments, its `type(scope):` prefix in its type's colour. */
export function titleSegs(title: string, style: Omit<Seg, "text"> = {}): Line {
  const intent = titleIntent(title)
  if (!intent) return [{ text: title, ...style }]
  return [
    { text: intent.prefix, ...style, fg: THEME.intent[intent.hue] },
    { text: intent.rest, ...style },
  ]
}

// OpenTUI draws ‼ two cells wide (it has an emoji form), which would shift the column border.
export const priorityGlyph = (priority: TaskPriority, ui: Ui) =>
  priority === "urgent" ? "!!" : glyphs(ui).priority[priority]

export const statusSeg = (status: TaskStatus, ui: Ui): Seg => ({
  text: `${glyphs(ui).status[status]} ${STATUS_LABELS[status]}`,
  fg: THEME.status[status],
})

export function dueSeg(task: Pick<Task, "dueAt" | "status">, ui: Ui): Seg | undefined {
  if (!task.dueAt) return undefined
  const text = dueText(task.dueAt, task.status, { color: false, unicode: ui.unicode, width: 80 })
  const state = dueState(task.dueAt, task.status)
  return {
    text,
    fg: state === "overdue" ? THEME.error : state === "soon" ? THEME.warn : THEME.muted,
  }
}

export type PanelOpts = {
  title: string
  w: number
  h: number
  left?: number
  top?: number
  bottomTitle?: string
}

export function createKit(renderer: CliRenderer, store: Store, ui: Ui, root: BoxRenderable) {
  const text = (lines: Line[], opts: ConstructorParameters<typeof TextRenderable>[1] = {}) =>
    new TextRenderable(renderer, { content: styled(lines, ui.color), wrapMode: "none", ...opts })

  const focusFill = (focused: boolean): Omit<Seg, "text"> =>
    focused ? (ui.color ? { bg: THEME.focusBg } : { inverse: true }) : {}

  // The bar in front of the focused card, row or item.
  const marker = (focused: boolean, fill: Omit<Seg, "text"> = {}): Seg => ({
    text: focused ? (ui.unicode ? "▌" : ">") : " ",
    fg: THEME.accent,
    ...fill,
  })

  // A bordered box over the board, centred unless placed.
  function panel(opts: PanelOpts, lines: Line[], z: number) {
    const W = renderer.width
    const H = renderer.height
    const box = new BoxRenderable(renderer, {
      position: "absolute",
      left: opts.left ?? Math.max(0, Math.floor((W - opts.w) / 2)),
      top: opts.top ?? Math.max(1, Math.floor((H - opts.h) / 2)),
      width: opts.w,
      height: opts.h,
      border: true,
      borderStyle: "rounded",
      borderColor: THEME.accent,
      backgroundColor: THEME.overlayBg,
      title: truncate(` ${opts.title} `, opts.w - 4),
      bottomTitle: opts.bottomTitle,
      bottomTitleAlignment: "right",
      zIndex: z,
    })
    box.add(text(lines))
    root.add(box)
  }

  return { renderer, store, ui, text, focusFill, marker, panel }
}

export type Kit = ReturnType<typeof createKit>
