// The detail pane: a task's properties, description, subtasks, relationships, artifacts and
// history, on the right of the board.
import { PRIORITY_LABELS, relativeTime, STATUS_LABELS } from "@intesa/task-query"
import { glyphs } from "../api"
import { clamp, type DetailOverlay, type State, taskById } from "../state"
import { fit, fromAnsi, type Line, truncate, wrap } from "../text"
import { dueSeg, type Kit, priorityGlyph, statusSeg, THEME, titleSegs } from "./kit"

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

export function createDetailView(kit: Kit, redraw: () => void) {
  const { renderer, store, ui, focusFill, marker, panel } = kit
  // The scroll of each open pane (by its place in the stack) and how far it can go: only the
  // view knows how many lines a pane has.
  const scrolls = new Map<string, { at: number; max: number }>()
  const keyOf = (s: State, o: DetailOverlay) => `${s.overlays.indexOf(o)}:${o.taskId}`
  store.onDetailScroll((o, delta) => {
    const key = keyOf(store.state, o)
    const scroll = scrolls.get(key)
    if (!scroll) return
    scroll.at = clamp(scroll.at + delta, scroll.max)
    redraw()
  })

  function lines(s: State, o: DetailOverlay, cols: number) {
    const entry = s.details[o.taskId]
    const detail = entry?.task
    // The list has the latest optimistic values; the detail adds what the list lacks.
    const task = taskById(s, o.taskId) ?? detail
    const out: Line[] = []
    const itemLines: number[] = []
    if (!task) {
      out.push([{ text: entry?.error ?? "Loading…", fg: entry?.error ? THEME.error : THEME.muted }])
      return { lines: out, itemLines }
    }
    const heading = (t: string): Line => [{ text: t, bold: true, fg: THEME.accent }]
    const prop = (name: string, value: Line) =>
      out.push([{ text: name.padEnd(11), fg: THEME.muted }, ...value])
    const none = (t: string): Line => [{ text: t, fg: THEME.muted }]
    // A prefix the wrap cuts in two stays plain.
    wrap(task.title, cols).forEach((l, i) => {
      out.push(i === 0 ? titleSegs(l, { bold: true }) : [{ text: l, bold: true }])
    })
    out.push([])
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
        : none("None"),
    )
    const due = dueSeg(task, ui)
    prop("Due", due ? [due, { text: `  ${task.dueAt}`, fg: THEME.muted }] : none("None"))
    prop(
      "Assignees",
      task.assignees.length
        ? [{ text: task.assignees.map((a) => a.name).join(", "), fg: THEME.person }]
        : none("Nobody"),
    )
    prop(
      "Tags",
      task.tags.length
        ? [{ text: task.tags.map((t) => `#${t.name}`).join(" "), fg: THEME.tag }]
        : none("None"),
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
              : none("Empty"),
        )
      }
    }
    if (entry?.error) out.push([], [{ text: entry.error, fg: THEME.error }])
    if (!detail) {
      out.push([], none("Loading…"))
      return { lines: out, itemLines }
    }
    if (task.body?.trim()) {
      out.push([], heading("Description"))
      const md = Bun.markdown.ansi(task.body, {
        colors: ui.color,
        hyperlinks: false,
        columns: cols,
      })
      out.push(...fromAnsi(md.replace(/\n+$/, "")).map((l) => fit(l, cols)))
    }
    if (detail.subtasks.length) {
      out.push([], heading(`Subtasks ${detail.subtaskDoneCount}/${detail.subtaskCount}`))
      detail.subtasks.forEach((sub, i) => {
        const selected = o.item === i
        const fill = focusFill(selected)
        const live = taskById(s, sub.id) ?? sub
        itemLines[i] = out.length
        out.push(
          fit(
            [
              marker(selected, fill),
              {
                text: `${glyphs(ui).status[live.status]} `,
                fg: THEME.status[live.status],
                ...fill,
              },
              { text: `${live.key}  `, fg: THEME.muted, ...fill },
              ...titleSegs(live.title, { strike: live.status === "complete", ...fill }),
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
      out.push([], heading("Relationships"))
      for (const r of relations) {
        out.push(
          fit(
            [
              { text: ` ${r.kind.padEnd(11)}`, fg: THEME.muted },
              { text: `${r.key}  `, fg: THEME.muted },
              ...titleSegs(r.title),
              { text: `  ${STATUS_LABELS[r.status]}`, fg: THEME.status[r.status] },
            ],
            cols,
          ),
        )
      }
    }
    if (entry.artifacts.length) {
      out.push([], heading(`Artifacts (${entry.artifacts.length})`))
      entry.artifacts.forEach((a, i) => {
        const at = detail.subtasks.length + i
        const selected = o.item === at
        const fill = focusFill(selected)
        itemLines[at] = out.length
        out.push(
          fit(
            [
              marker(selected, fill),
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
      out.push([], heading("History"))
      const arrow = glyphs(ui).arrow
      for (const h of entry.history) {
        const from = h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} ${arrow} ` : ""
        out.push(
          fit(
            [
              { text: ` ${relativeTime(h.updatedAt)}  `, fg: THEME.muted },
              { text: `${h.updatedBy.name}  ` },
              { text: `${from}${STATUS_LABELS[h.toStatus]}` },
            ],
            cols,
          ),
        )
      }
    }
    return { lines: out, itemLines }
  }

  // Forgets the scroll of panes that have closed.
  function prune(s: State) {
    const open = new Set(s.overlays.flatMap((o) => (o.kind === "detail" ? [keyOf(s, o)] : [])))
    for (const key of scrolls.keys()) if (!open.has(key)) scrolls.delete(key)
  }

  function draw(s: State, o: DetailOverlay, z: number) {
    const W = renderer.width
    const H = renderer.height
    const w = W >= 100 ? Math.floor(W * 0.6) : W
    const h = H - 2
    const cols = w - 4
    const { lines: all, itemLines } = lines(s, o, cols)
    const room = h - 2
    const key = keyOf(s, o)
    const max = Math.max(0, all.length - room)
    // Kept inside what there is to show, and moved to show the selected subtask or artifact.
    let at = Math.min(scrolls.get(key)?.at ?? 0, max)
    const itemAt = o.item >= 0 ? itemLines[o.item] : undefined
    if (itemAt !== undefined) {
      if (itemAt < at) at = itemAt
      if (itemAt >= at + room) at = itemAt - room + 1
    }
    scrolls.set(key, { at, max })
    const title = taskById(s, o.taskId)?.key ?? s.details[o.taskId]?.task?.key ?? ""
    const pct = all.length > room ? ` ${Math.round(((at + room) / all.length) * 100)}% ` : undefined
    panel(
      { title, w, h, left: W - w, top: 1, bottomTitle: pct },
      all.slice(at, at + room).map((l) => [{ text: " " }, ...l]),
      z,
    )
  }

  return { draw, prune }
}
