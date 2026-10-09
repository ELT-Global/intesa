// Draws the store's state with OpenTUI. The whole tree is rebuilt on every change: a board is
// a dozen renderables (one text per column), so this is cheap and keeps drawing stateless,
// apart from each column's scroll position.

import {
  dueState,
  PRIORITY_LABELS,
  relativeTime,
  STATUS_LABELS,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@intesa/task-query"
import { BoxRenderable, type CliRenderer, type MouseEvent, TextRenderable } from "@opentui/core"
import { dueText, glyphs, type Task } from "./api"
import { HELP } from "./keymap"
import { handle } from "./model"
import {
  type DetailOverlay,
  filterLabel,
  type MenuOverlay,
  type Overlay,
  type PickerOverlay,
  pickerItems,
  railFocused,
  type State,
  type Store,
  type SyncOverlay,
  shownTasks,
  tableRows,
  taskById,
} from "./store"
import { fit, fromAnsi, type Line, type Seg, styled, truncate, width, wrap } from "./text"

export type Ui = { unicode: boolean; color: boolean }

const THEME = {
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
}

const CARD_ROWS = 3 // two lines and a gap
const RAIL_WIDTH = 3

type Column = { status: TaskStatus; x: number; w: number; cards: Task[]; start: number }
type BoardLayout = { rail: boolean; columns: Column[]; capacity: number }

// OpenTUI draws ‼ two cells wide (it has an emoji form), which would shift the column border.
const priorityGlyph = (priority: TaskPriority, ui: Ui) =>
  priority === "urgent" ? "!!" : glyphs(ui).priority[priority]

const statusSeg = (status: TaskStatus, ui: Ui): Seg => ({
  text: `${glyphs(ui).status[status]} ${STATUS_LABELS[status]}`,
  fg: THEME.status[status],
})

function dueSeg(task: Pick<Task, "dueAt" | "status">, ui: Ui): Seg | undefined {
  if (!task.dueAt) return undefined
  const text = dueText(task.dueAt, task.status, { color: false, unicode: ui.unicode, width: 80 })
  const state = dueState(task.dueAt, task.status)
  return {
    text,
    fg: state === "overdue" ? THEME.error : state === "soon" ? THEME.warn : THEME.muted,
  }
}

// The second line of a card: as many details as fit, most useful first.
function metaLine(task: Task, ui: Ui, cols: number): Line {
  const g = glyphs(ui)
  const parts: Seg[] = []
  if (task.priority)
    parts.push({ text: priorityGlyph(task.priority, ui), fg: THEME.priority[task.priority] })
  for (const a of task.assignees) parts.push({ text: handle(a.name), fg: THEME.person })
  const due = dueSeg(task, ui)
  if (due) parts.push(due)
  if (task.subtaskCount > 0) {
    parts.push({ text: g.subtasks(task.subtaskDoneCount, task.subtaskCount), fg: THEME.muted })
  }
  for (const t of task.tags) parts.push({ text: `#${t.name}`, fg: THEME.tag })
  const line: Line = []
  let used = 0
  for (const part of parts) {
    const add = width(part.text) + (line.length ? 1 : 0)
    if (used + add > cols) break
    if (line.length) line.push({ text: " " })
    line.push(part)
    used += add
  }
  return line
}

const fmtSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`

const fieldText = (value: unknown) =>
  value === undefined || value === null
    ? ""
    : typeof value === "boolean"
      ? value
        ? "yes"
        : "no"
      : String(value)

export function createView(renderer: CliRenderer, store: Store, ui: Ui) {
  const root = new BoxRenderable(renderer, {
    id: "board-root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
  })
  renderer.root.add(root)
  // First visible card per column, kept between frames so the list scrolls smoothly.
  const scrolls = new Map<TaskStatus, number>()
  let tableStart = 0

  const text = (lines: Line[], opts: ConstructorParameters<typeof TextRenderable>[1] = {}) =>
    new TextRenderable(renderer, { content: styled(lines, ui.color), wrapMode: "none", ...opts })

  const focusFill = (focused: boolean): Omit<Seg, "text"> =>
    focused ? (ui.color ? { bg: THEME.focusBg } : { inverse: true }) : {}

  function layout(s: State, W: number, H: number): BoardLayout {
    const rail = !s.backlogOpen
    const statuses = rail ? TASK_STATUSES.slice(1) : TASK_STATUSES
    const avail = W - (rail ? RAIL_WIDTH : 0)
    const base = Math.floor(avail / statuses.length)
    const extra = avail % statuses.length
    const capacity = Math.max(1, Math.floor((H - 2 - 2 + 1) / CARD_ROWS))
    const shown = shownTasks(s)
    let x = rail ? RAIL_WIDTH : 0
    const columns = statuses.map((status, i) => {
      const w = base + (i < extra ? 1 : 0)
      const cards = shown.filter((t) => t.status === status)
      let start = Math.min(scrolls.get(status) ?? 0, Math.max(0, cards.length - capacity))
      if (s.focus.status === status) {
        if (s.focus.index < start) start = s.focus.index
        if (s.focus.index >= start + capacity) start = s.focus.index - capacity + 1
      }
      scrolls.set(status, start)
      const col = { status, x, w, cards, start }
      x += w
      return col
    })
    return { rail, columns, capacity }
  }

  function header(s: State, W: number): Line {
    const view = s.view === "board" ? "Board" : "Table"
    const left: Line = [
      { text: ` ${s.workspace.slug}`, fg: THEME.muted },
      { text: " / " },
      { text: s.project ? s.project.key : "no project", bold: true },
      { text: ` · ${view}`, fg: THEME.muted },
    ]
    const right: Line = [
      { text: "filter: ", fg: THEME.muted },
      { text: filterLabel(s), fg: THEME.person },
      ...(s.query
        ? [
            { text: " · search: ", fg: THEME.muted },
            { text: s.query, fg: THEME.accent },
          ]
        : []),
      { text: " · ? help ", fg: THEME.muted },
    ]
    const gap = Math.max(
      1,
      W - width(left.map((x) => x.text).join("")) - width(right.map((x) => x.text).join("")),
    )
    return fit([...left, { text: " ".repeat(gap) }, ...right], W)
  }

  function footer(s: State, W: number): Line {
    const input = s.overlays.findLast((o) => o.kind === "input")
    if (input?.kind === "input") {
      return fit(
        [
          { text: ` ${input.label}: `, fg: THEME.accent },
          { text: input.value },
          { text: ui.unicode ? "▏" : "_", fg: THEME.accent },
          ...(input.error ? [{ text: `  ${input.error}`, fg: THEME.error }] : []),
        ],
        W,
      )
    }
    if (s.toast) {
      const text = s.toast.error ? `${ui.unicode ? "✗" : "x"} ${s.toast.text}` : s.toast.text
      return fit([{ text: ` ${text}`, fg: s.toast.error ? THEME.error : THEME.accent }], W)
    }
    const top = s.overlays.at(-1)?.kind
    const arrows = ui.unicode ? { lr: "←→", ud: "↑↓" } : { lr: "left/right", ud: "up/down" }
    const hints =
      top === "detail"
        ? `esc back · ${arrows.ud} scroll · tab select · space done · enter open · e edit · m menu · ? help`
        : s.view === "table"
          ? `1-4 sort · enter open · n new · / search · m menu · b board · ? help · q quit`
          : `n new · / search · enter open · alt+${arrows.lr} move · alt+${arrows.ud} reorder · m menu · ? help · q quit`
    return fit([{ text: ` ${hints}`, fg: THEME.muted }], W)
  }

  function cardLines(task: Task, cols: number, focused: boolean): Line[] {
    const fill = focusFill(focused)
    const bar: Seg = { text: focused ? (ui.unicode ? "▌" : ">") : " ", fg: THEME.accent, ...fill }
    const first: Line = [
      bar,
      { text: task.key, fg: THEME.muted, bold: true, ...fill },
      { text: " ", ...fill },
      { text: task.title, bold: focused, ...fill },
    ]
    const second: Line = [bar, ...metaLine(task, ui, cols - 2).map((x) => ({ ...x, ...fill }))]
    return [fit(first, cols, fill), fit(second, cols, fill)]
  }

  function drawBoard(s: State, parent: BoxRenderable, W: number, H: number) {
    const { rail, columns, capacity } = layout(s, W, H)
    const row = new BoxRenderable(renderer, { flexDirection: "row", height: H - 2, width: W })
    parent.add(row)
    if (rail) {
      const count = shownTasks(s).filter((t) => t.status === "backlog").length
      const focused = railFocused(s)
      const letters = [...STATUS_LABELS.backlog].map((ch): Line => [{ text: ch, bold: focused }])
      const box = new BoxRenderable(renderer, {
        width: RAIL_WIDTH,
        height: H - 2,
        border: true,
        borderStyle: "rounded",
        borderColor: focused ? THEME.accent : THEME.border,
        onMouseDown: () => {
          store.focusCard("backlog", 0)
          store.activate()
        },
      })
      box.add(text([[{ text: String(count), fg: THEME.muted }], [], ...letters]))
      row.add(box)
    }
    for (const col of columns) {
      const focusedColumn = !railFocused(s) && s.focus.status === col.status
      const inner = col.w - 2
      const lines: Line[] = []
      const visible = col.cards.slice(col.start, col.start + capacity)
      visible.forEach((task, i) => {
        if (i > 0) lines.push([])
        const focused = focusedColumn && s.view === "board" && col.start + i === s.focus.index
        lines.push(...cardLines(task, inner, focused))
      })
      if (col.cards.length === 0) lines.push([{ text: " No tasks", fg: THEME.muted, dim: true }])
      const above = col.start
      const below = Math.max(0, col.cards.length - col.start - capacity)
      const arrows = ui.unicode ? ["↑", "↓"] : ["^", "v"]
      const more = [above ? `${arrows[0]}${above}` : "", below ? `${arrows[1]}${below}` : ""]
        .filter(Boolean)
        .join(" ")
      const box = new BoxRenderable(renderer, {
        width: col.w,
        height: H - 2,
        border: true,
        borderStyle: "rounded",
        borderColor: focusedColumn ? THEME.accent : THEME.border,
        title: truncate(` ${STATUS_LABELS[col.status]} (${col.cards.length}) `, col.w - 4),
        titleColor: focusedColumn ? THEME.accent : undefined,
        bottomTitle: more ? ` ${more} ` : undefined,
        bottomTitleAlignment: "right",
        onMouseDown: (e: MouseEvent) => {
          const offset = e.y - 2
          if (offset < 0 || offset % CARD_ROWS === 2) return
          const index = col.start + Math.floor(offset / CARD_ROWS)
          if (index >= col.cards.length) return
          const same = s.focus.status === col.status && s.focus.index === index
          store.focusCard(col.status, index)
          if (same) store.activate()
        },
      })
      box.add(text(lines))
      row.add(box)
    }
  }

  function drawTable(s: State, parent: BoxRenderable, W: number, H: number) {
    const rows = tableRows(s)
    const keyW = Math.max(4, ...rows.map((t) => width(t.key)))
    const cols = [
      { id: "status", label: "Status", w: 14, sort: "status" },
      { id: "priority", label: "Priority", w: 10, sort: "priority" },
      ...(W >= 90 ? [{ id: "assignees", label: "Assignees", w: 16 }] : []),
      ...(W >= 110 ? [{ id: "tags", label: "Tags", w: 14 }] : []),
      { id: "due", label: "Due", w: 14, sort: "due" },
    ]
    const titleW = Math.max(10, W - 2 - keyW - 2 - cols.reduce((n, c) => n + c.w + 2, 0))
    const arrow = (key: string) =>
      s.sort?.key === key
        ? s.sort.dir === "asc"
          ? ui.unicode
            ? " ↑"
            : " ^"
          : ui.unicode
            ? " ↓"
            : " v"
        : ""
    const cell = (seg: Seg | undefined, w: number, fill: Omit<Seg, "text">) =>
      fit(seg ? [{ ...seg, ...fill }] : [], w, fill)
    const headerLine: Line = [
      { text: " " },
      ...fit([{ text: `Task${arrow("task")}`, bold: true }], keyW + 2 + titleW),
      ...cols.flatMap((c) => [
        { text: "  " },
        ...fit([{ text: `${c.label}${arrow(c.sort ?? "")}`, bold: true }], c.w),
      ]),
    ]
    const capacity = Math.max(1, H - 3)
    if (s.row.index < tableStart) tableStart = s.row.index
    if (s.row.index >= tableStart + capacity) tableStart = s.row.index - capacity + 1
    tableStart = Math.min(tableStart, Math.max(0, rows.length - capacity))
    const lines: Line[] = [fit(headerLine, W)]
    rows.slice(tableStart, tableStart + capacity).forEach((t, i) => {
      const focused = tableStart + i === s.row.index
      const fill = focusFill(focused)
      const values: Record<string, Seg | undefined> = {
        status: statusSeg(t.status, ui),
        priority: t.priority
          ? { text: PRIORITY_LABELS[t.priority], fg: THEME.priority[t.priority] }
          : undefined,
        assignees: t.assignees.length
          ? { text: t.assignees.map((a) => handle(a.name)).join(" "), fg: THEME.person }
          : undefined,
        tags: t.tags.length
          ? { text: t.tags.map((g) => `#${g.name}`).join(" "), fg: THEME.tag }
          : undefined,
        due: dueSeg(t, ui),
      }
      lines.push(
        fit(
          [
            { text: focused ? (ui.unicode ? "▌" : ">") : " ", fg: THEME.accent, ...fill },
            ...cell({ text: t.key, fg: THEME.muted, bold: true }, keyW, fill),
            { text: "  ", ...fill },
            ...cell({ text: t.title }, titleW, fill),
            ...cols.flatMap((c) => [{ text: "  ", ...fill }, ...cell(values[c.id], c.w, fill)]),
          ],
          W,
          fill,
        ),
      )
    })
    if (rows.length === 0) lines.push([{ text: " No tasks match.", fg: THEME.muted }])
    parent.add(
      text(lines, {
        height: H - 2,
        onMouseDown: (e: MouseEvent) => {
          const index = tableStart + e.y - 2
          if (e.y < 2 || index >= rows.length) return
          const same = s.row.index === index
          store.focusRow(index)
          if (same) store.activate()
        },
      }),
    )
  }

  // --- Overlays ---

  function panel(
    opts: {
      title: string
      w: number
      h: number
      left?: number
      top?: number
      bottomTitle?: string
    },
    lines: Line[],
    z: number,
  ) {
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

  function detailLines(s: State, o: DetailOverlay, cols: number) {
    const entry = s.details[o.taskId]
    const detail = entry?.task
    // The list has the latest optimistic values; the detail adds what the list lacks.
    const task = taskById(s, o.taskId) ?? detail
    const lines: Line[] = []
    const itemLines: number[] = []
    if (!task) {
      lines.push([
        { text: entry?.error ?? "Loading…", fg: entry?.error ? THEME.error : THEME.muted },
      ])
      return { lines, itemLines }
    }
    const heading = (t: string): Line => [{ text: t, bold: true, fg: THEME.accent }]
    const prop = (name: string, value: Line) =>
      lines.push([{ text: name.padEnd(11), fg: THEME.muted }, ...value])
    for (const l of wrap(task.title, cols)) lines.push([{ text: l, bold: true }])
    lines.push([])
    prop("Status", [statusSeg(task.status, ui)])
    prop(
      "Priority",
      task.priority
        ? [
            {
              text: `${priorityGlyph(task.priority, ui)} ${PRIORITY_LABELS[task.priority]}`,
              fg: THEME.priority[task.priority],
            },
          ]
        : [{ text: "None", fg: THEME.muted }],
    )
    const due = dueSeg(task, ui)
    prop(
      "Due",
      due
        ? [due, { text: `  ${task.dueAt}`, fg: THEME.muted }]
        : [{ text: "None", fg: THEME.muted }],
    )
    prop(
      "Assignees",
      task.assignees.length
        ? [{ text: task.assignees.map((a) => a.name).join(", "), fg: THEME.person }]
        : [{ text: "Nobody", fg: THEME.muted }],
    )
    prop(
      "Tags",
      task.tags.length
        ? [{ text: task.tags.map((t) => `#${t.name}`).join(" "), fg: THEME.tag }]
        : [{ text: "None", fg: THEME.muted }],
    )
    if (detail?.parent) prop("Parent", [{ text: `${detail.parent.key}  ${detail.parent.title}` }])
    if (detail) {
      for (const f of s.fields.filter((f) => f.projectId === detail.projectId)) {
        const value = fieldText(detail.customFields[f.id])
        prop(
          truncate(f.name, 10),
          value
            ? [{ text: value }]
            : f.required
              ? [{ text: "Required", fg: THEME.warn }]
              : [{ text: "Empty", fg: THEME.muted }],
        )
      }
    }
    if (entry?.error) lines.push([], [{ text: entry.error, fg: THEME.error }])
    if (!detail) {
      lines.push([], [{ text: "Loading…", fg: THEME.muted }])
      return { lines, itemLines }
    }
    if (task.body?.trim()) {
      lines.push([], heading("Description"))
      const md = Bun.markdown.ansi(task.body, {
        colors: ui.color,
        hyperlinks: false,
        columns: cols,
      })
      const rendered = fromAnsi(md.replace(/\n+$/, ""))
      lines.push(...rendered.map((l) => fit(l, cols)))
    }
    if (detail.subtasks.length) {
      lines.push([], heading(`Subtasks ${detail.subtaskDoneCount}/${detail.subtaskCount}`))
      detail.subtasks.forEach((sub, i) => {
        const selected = o.item === i
        const fill = focusFill(selected)
        const live = taskById(s, sub.id) ?? sub
        itemLines[i] = lines.length
        lines.push(
          fit(
            [
              { text: selected ? (ui.unicode ? "▌" : ">") : " ", fg: THEME.accent, ...fill },
              {
                text: `${glyphs(ui).status[live.status]} `,
                fg: THEME.status[live.status],
                ...fill,
              },
              { text: `${live.key}  `, fg: THEME.muted, ...fill },
              { text: live.title, strike: live.status === "complete", ...fill },
            ],
            cols,
            fill,
          ),
        )
      })
    }
    const relations = (
      [
        ["Blocks", detail.blocks],
        ["Blocked by", detail.blockedBy],
        ["Related", detail.related],
      ] as const
    ).flatMap(([kind, refs]) => refs.map((r) => ({ kind, ...r })))
    if (relations.length) {
      lines.push([], heading("Relationships"))
      for (const r of relations) {
        lines.push(
          fit(
            [
              { text: ` ${r.kind.padEnd(11)}`, fg: THEME.muted },
              { text: `${r.key}  `, fg: THEME.muted },
              { text: r.title },
              { text: `  ${STATUS_LABELS[r.status]}`, fg: THEME.status[r.status] },
            ],
            cols,
          ),
        )
      }
    }
    if (entry.artifacts.length) {
      lines.push([], heading(`Artifacts (${entry.artifacts.length})`))
      entry.artifacts.forEach((a, i) => {
        const at = detail.subtasks.length + i
        const selected = o.item === at
        const fill = focusFill(selected)
        itemLines[at] = lines.length
        lines.push(
          fit(
            [
              { text: selected ? (ui.unicode ? "▌" : ">") : " ", fg: THEME.accent, ...fill },
              { text: a.name, ...fill },
              { text: `  ${a.mimeType}  ${fmtSize(a.size)}`, fg: THEME.muted, ...fill },
            ],
            cols,
            fill,
          ),
        )
      })
    }
    if (entry.history.length) {
      lines.push([], heading("History"))
      const arrow = glyphs(ui).arrow
      for (const h of entry.history) {
        lines.push(
          fit(
            [
              { text: ` ${relativeTime(h.updatedAt)}  `, fg: THEME.muted },
              { text: `${h.updatedBy.name}  ` },
              {
                text: `${h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} ${arrow} ` : ""}${STATUS_LABELS[h.toStatus]}`,
              },
            ],
            cols,
          ),
        )
      }
    }
    return { lines, itemLines }
  }

  function drawDetail(s: State, o: DetailOverlay, z: number) {
    const W = renderer.width
    const H = renderer.height
    const w = W >= 100 ? Math.floor(W * 0.6) : W
    const h = H - 2
    const cols = w - 4
    const { lines, itemLines } = detailLines(s, o, cols)
    const room = h - 2
    // The scroll lives in the store; it is kept inside what was drawn here, and moved to show
    // the selected subtask or artifact.
    let scroll = Math.min(o.scroll, Math.max(0, lines.length - room))
    const itemAt = o.item >= 0 ? itemLines[o.item] : undefined
    if (itemAt !== undefined) {
      if (itemAt < scroll) scroll = itemAt
      if (itemAt >= scroll + room) scroll = itemAt - room + 1
    }
    o.scroll = scroll
    const key = taskById(s, o.taskId)?.key ?? s.details[o.taskId]?.task?.key ?? ""
    const pct =
      lines.length > room ? ` ${Math.round(((scroll + room) / lines.length) * 100)}% ` : undefined
    panel(
      { title: key, w, h, left: W - w, top: 1, bottomTitle: pct },
      lines.slice(scroll, scroll + room).map((l) => [{ text: " " }, ...l]),
      z,
    )
  }

  function drawMenu(o: MenuOverlay, z: number) {
    const labelW = Math.max(...o.items.map((i) => width(i.label)))
    const w = Math.min(renderer.width - 2, Math.max(labelW + 10, width(o.title) + 6))
    const lines = o.items.map((item, i) => {
      const selected = i === o.index
      const fill = focusFill(selected)
      const key = item.key && item.key.length === 1 ? item.key : " "
      return fit(
        [
          { text: selected ? (ui.unicode ? "▌" : ">") : " ", fg: THEME.accent, ...fill },
          { text: `${key}  `, fg: THEME.accent, ...fill },
          { text: item.label, bold: selected, ...fill },
          { text: item.current ? (ui.unicode ? "  ●" : "  *") : "", fg: THEME.ok, ...fill },
        ],
        w - 2,
        fill,
      )
    })
    panel({ title: o.title, w, h: lines.length + 2 }, lines, z)
  }

  function drawPicker(o: PickerOverlay, z: number) {
    const items = pickerItems(o)
    const w = Math.min(renderer.width - 2, 60)
    const room = Math.max(1, Math.min(items.length, renderer.height - 8))
    const start = Math.max(0, o.index - room + 1)
    const lines: Line[] = [
      fit(
        [
          { text: "> ", fg: THEME.accent },
          { text: o.query },
          { text: ui.unicode ? "▏" : "_", fg: THEME.accent },
        ],
        w - 2,
      ),
      [],
    ]
    items.slice(start, start + room).forEach((item, i) => {
      const selected = start + i === o.index
      const fill = focusFill(selected)
      lines.push(
        fit(
          [
            { text: selected ? (ui.unicode ? "▌" : ">") : " ", fg: THEME.accent, ...fill },
            { text: item.label, ...fill },
          ],
          w - 2,
          fill,
        ),
      )
    })
    if (items.length === 0) lines.push([{ text: " No matches", fg: THEME.muted }])
    panel({ title: o.title, w, h: lines.length + 2 }, lines, z)
  }

  function drawSync(o: SyncOverlay, z: number) {
    const w = Math.min(renderer.width - 2, 72)
    const cols = w - 4
    const label = STATUS_LABELS[o.status]
    const lines: Line[] = wrap(
      `${o.task.key} moved to ${label}. Choose the state of its subtasks.`,
      cols,
    ).map((l) => [{ text: l }])
    lines.push([])
    // Room for the widest status ("◐ In progress") and the changed mark after it.
    const statusW = 13 + 2
    o.subtasks.forEach((sub, i) => {
      const status = o.picked[sub.id] ?? sub.status
      const changed = status !== sub.status
      const selected = i === o.index
      const fill = focusFill(selected)
      const head = `${sub.key}  `
      const titleW = Math.max(4, cols - 1 - width(head) - 2 - statusW)
      lines.push(
        fit(
          [
            { text: selected ? (ui.unicode ? "▌" : ">") : " ", fg: THEME.accent, ...fill },
            { text: head, fg: THEME.muted, ...fill },
            { text: truncate(sub.title, titleW).padEnd(titleW), ...fill },
            { text: "  ", ...fill },
            { ...statusSeg(status, ui), bold: changed, ...fill },
            { text: changed ? " *" : "", fg: THEME.accent, ...fill },
          ],
          cols,
          fill,
        ),
      )
    })
    const changed = o.subtasks.filter(
      (sub) => (o.picked[sub.id] ?? sub.status) !== sub.status,
    ).length
    lines.push([])
    lines.push([
      {
        text: `a set all to ${label} · ${ui.unicode ? "←→" : "left/right"} change`,
        fg: THEME.muted,
      },
    ])
    lines.push([
      { text: "enter ", fg: THEME.accent },
      {
        text: changed ? `update ${changed} ${changed === 1 ? "subtask" : "subtasks"}` : "update",
        fg: THEME.muted,
      },
      { text: " · esc leave as is", fg: THEME.muted },
    ])
    panel(
      { title: "Update subtasks?", w, h: Math.min(renderer.height - 2, lines.length + 2) },
      lines.map((l) => [{ text: " " }, ...l]),
      z,
    )
  }

  function drawHelp(z: number) {
    const keyW = Math.max(...HELP.map(([k]) => width(k))) + 2
    const w = Math.min(renderer.width - 2, keyW + 70)
    const lines = HELP.map(
      ([keys, what]): Line => [{ text: ` ${keys.padEnd(keyW)}`, fg: THEME.accent }, { text: what }],
    ).map((l) => fit(l, w - 2))
    panel(
      {
        title: "Keys",
        w,
        h: Math.min(renderer.height - 2, lines.length + 2),
        bottomTitle: " esc close ",
      },
      lines,
      z,
    )
  }

  function drawOverlay(s: State, o: Overlay, z: number) {
    switch (o.kind) {
      case "detail":
        return drawDetail(s, o, z)
      case "menu":
        return drawMenu(o, z)
      case "picker":
        return drawPicker(o, z)
      case "sync":
        return drawSync(o, z)
      case "help":
        return drawHelp(z)
      case "confirm": {
        const w = Math.min(renderer.width - 2, 64)
        const lines: Line[] = wrap(o.message, w - 4).map((l) => [{ text: ` ${l}` }])
        lines.push(
          [],
          [
            { text: " y ", fg: THEME.error, bold: true },
            { text: "delete · ", fg: THEME.muted },
            { text: "n ", fg: THEME.accent },
            { text: "cancel", fg: THEME.muted },
          ],
        )
        return panel({ title: "Delete task?", w, h: lines.length + 2 }, lines, z)
      }
      case "input":
        return // drawn in the footer
    }
  }

  function draw() {
    const s = store.state
    const W = renderer.width
    const H = renderer.height
    for (const child of root.getChildren()) child.destroyRecursively()
    if (W < 40 || H < 10) {
      root.add(text([[{ text: "The terminal is too small for the board." }]]))
      renderer.requestRender()
      return
    }
    root.add(text([header(s, W)], { height: 1 }))
    const body = new BoxRenderable(renderer, { height: H - 2, width: W })
    root.add(body)
    if (!s.project || !s.loaded) {
      const message = s.error ?? (s.project ? "Loading…" : "Pick a project (P)")
      body.add(text([[{ text: ` ${message}`, fg: s.error ? THEME.error : THEME.muted }]]))
    } else if (s.view === "table") drawTable(s, body, W, H)
    else drawBoard(s, body, W, H)
    root.add(text([footer(s, W)], { height: 1 }))
    for (const [i, o] of s.overlays.entries()) drawOverlay(s, o, 10 + i)
    renderer.requestRender()
  }

  return { draw, root }
}
