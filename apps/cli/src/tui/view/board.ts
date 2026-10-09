// The columns: a folded Backlog rail or its column, then one column of cards per status.
import { STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@intesa/task-query"
import { BoxRenderable, type MouseEvent } from "@opentui/core"
import { glyphs, type Task } from "../api"
import { handle } from "../model"
import { railFocused, type State, shownTasks } from "../state"
import { fit, type Line, type Seg, truncate, width } from "../text"
import { dueSeg, type Kit, priorityGlyph, THEME } from "./kit"

const CARD_ROWS = 3 // two lines and a gap
const RAIL_WIDTH = 3

type Column = { status: TaskStatus; x: number; w: number; cards: Task[]; start: number }

export function createBoardView(kit: Kit) {
  const { renderer, store, ui, text, focusFill, marker } = kit
  // First visible card per column, kept between frames so the list scrolls smoothly.
  const scrolls = new Map<TaskStatus, number>()
  // Clicks reach the board under an open overlay; they are for the overlay, not the board.
  const blocked = () => store.state.overlays.length > 0

  function layout(s: State, W: number, H: number) {
    const rail = !s.backlogOpen
    const statuses = rail ? TASK_STATUSES.slice(1) : TASK_STATUSES
    const avail = W - (rail ? RAIL_WIDTH : 0)
    const base = Math.floor(avail / statuses.length)
    const extra = avail % statuses.length
    const capacity = Math.max(1, Math.floor((H - 2 - 2 + 1) / CARD_ROWS))
    const shown = shownTasks(s)
    let x = rail ? RAIL_WIDTH : 0
    const columns = statuses.map((status, i): Column => {
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

  // The second line of a card: as many details as fit, most useful first.
  function metaLine(task: Task, cols: number): Line {
    const g = glyphs(ui)
    const parts: Seg[] = []
    if (task.priority) {
      parts.push({ text: priorityGlyph(task.priority, ui), fg: THEME.priority[task.priority] })
    }
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

  function cardLines(task: Task, cols: number, focused: boolean): Line[] {
    const fill = focusFill(focused)
    const bar = marker(focused, fill)
    const first: Line = [
      bar,
      { text: task.key, fg: THEME.muted, bold: true, ...fill },
      { text: " ", ...fill },
      { text: task.title, bold: focused, ...fill },
    ]
    const second: Line = [bar, ...metaLine(task, cols - 2).map((x) => ({ ...x, ...fill }))]
    return [fit(first, cols, fill), fit(second, cols, fill)]
  }

  function drawRail(s: State, parent: BoxRenderable, H: number) {
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
        if (blocked()) return
        store.focusCard("backlog", 0)
        store.activate()
      },
    })
    box.add(text([[{ text: String(count), fg: THEME.muted }], [], ...letters]))
    parent.add(box)
  }

  function drawColumn(s: State, col: Column, capacity: number, parent: BoxRenderable, H: number) {
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
      // A click focuses a card, a second click opens it.
      onMouseDown: (e: MouseEvent) => {
        if (blocked()) return
        const offset = e.y - 2
        if (offset < 0 || offset % CARD_ROWS === 2) return
        const index = col.start + Math.floor(offset / CARD_ROWS)
        const card = col.cards[index]
        if (!card) return
        const { focus } = store.state
        if (focus.status === col.status && focus.taskId === card.id) store.openDetail(card.id)
        else store.focusCard(col.status, index)
      },
    })
    box.add(text(lines))
    parent.add(box)
  }

  return function draw(s: State, parent: BoxRenderable, W: number, H: number) {
    const { rail, columns, capacity } = layout(s, W, H)
    const row = new BoxRenderable(renderer, { flexDirection: "row", height: H - 2, width: W })
    parent.add(row)
    if (rail) drawRail(s, row, H)
    for (const col of columns) drawColumn(s, col, capacity, row, H)
  }
}
