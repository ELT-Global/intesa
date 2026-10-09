// The small overlays: menus, pickers, the delete confirmation, the subtask dialog and help.
import { STATUS_LABELS } from "@intesa/task-query"
import { plural } from "../api"
import { HELP } from "../keymap"
import {
  type ConfirmOverlay,
  type MenuOverlay,
  type PickerOverlay,
  pickerItems,
  type SyncOverlay,
} from "../state"
import { fit, type Line, truncate, width, wrap } from "../text"
import { type Kit, statusSeg, THEME } from "./kit"

export function createDialogs(kit: Kit) {
  const { renderer, ui, focusFill, marker, panel } = kit

  function menu(o: MenuOverlay, z: number) {
    const labelW = Math.max(...o.items.map((i) => width(i.label)))
    const w = Math.min(renderer.width - 2, Math.max(labelW + 10, width(o.title) + 6))
    const lines = o.items.map((item, i) => {
      const selected = i === o.index
      const fill = focusFill(selected)
      const key = item.key && item.key.length === 1 ? item.key : " "
      return fit(
        [
          marker(selected, fill),
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

  function picker(o: PickerOverlay, z: number) {
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
      lines.push(fit([marker(selected, fill), { text: item.label, ...fill }], w - 2, fill))
    })
    if (items.length === 0) lines.push([{ text: " No matches", fg: THEME.muted }])
    panel({ title: o.title, w, h: lines.length + 2 }, lines, z)
  }

  function sync(o: SyncOverlay, z: number) {
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
            marker(selected, fill),
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
    lines.push(
      [],
      [
        {
          text: `a set all to ${label} · ${ui.unicode ? "←→" : "left/right"} change`,
          fg: THEME.muted,
        },
      ],
      [
        { text: "enter ", fg: THEME.accent },
        { text: changed ? `update ${plural(changed, "subtask")}` : "update", fg: THEME.muted },
        { text: " · esc leave as is", fg: THEME.muted },
      ],
    )
    panel(
      { title: "Update subtasks?", w, h: Math.min(renderer.height - 2, lines.length + 2) },
      lines.map((l) => [{ text: " " }, ...l]),
      z,
    )
  }

  function help(z: number) {
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

  function confirm(o: ConfirmOverlay, z: number) {
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
    panel({ title: "Delete task?", w, h: lines.length + 2 }, lines, z)
  }

  return { menu, picker, sync, help, confirm }
}
