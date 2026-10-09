// The table: one row per task, sortable by its headers' keys (1-4).
import { PRIORITY_LABELS } from "@intesa/task-query"
import type { BoxRenderable, MouseEvent } from "@opentui/core"
import { handle } from "../api"
import { type State, tableRows } from "../state"
import { fit, type Line, type Seg, width } from "../text"
import { dueSeg, type Kit, statusSeg, THEME } from "./kit"

export function createTableView(kit: Kit) {
  const { store, ui, text, focusFill, marker } = kit
  // The first row in view, kept between frames like the columns' scroll.
  let start = 0

  return function draw(s: State, parent: BoxRenderable, W: number, H: number) {
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
    const up = ui.unicode ? " ↑" : " ^"
    const down = ui.unicode ? " ↓" : " v"
    const arrow = (key: string) => (s.sort?.key === key ? (s.sort.dir === "asc" ? up : down) : "")
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
    if (s.row.index < start) start = s.row.index
    if (s.row.index >= start + capacity) start = s.row.index - capacity + 1
    start = Math.min(start, Math.max(0, rows.length - capacity))
    const lines: Line[] = [fit(headerLine, W)]
    rows.slice(start, start + capacity).forEach((t, i) => {
      const focused = start + i === s.row.index
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
            marker(focused, fill),
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
        // A click focuses a row, a second click opens it; not while an overlay is open.
        onMouseDown: (e: MouseEvent) => {
          const task = rows[start + e.y - 2]
          if (e.y < 2 || !task || store.state.overlays.length > 0) return
          if (store.state.row.taskId === task.id) store.openDetail(task.id)
          else store.focusRow(start + e.y - 2)
        },
      }),
    )
  }
}
