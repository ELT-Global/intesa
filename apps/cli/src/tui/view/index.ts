// Draws the store's state with OpenTUI. The whole tree is rebuilt on every change: a board is
// a dozen renderables (one text per column), so this is cheap and keeps drawing stateless,
// apart from scroll positions.
import { BoxRenderable, type CliRenderer } from "@opentui/core"
import { filterLabel, type Overlay, type State } from "../state"
import type { Store } from "../store"
import { fit, type Line, width } from "../text"
import { createBoardView } from "./board"
import { createDetailView } from "./detail"
import { createDialogs } from "./dialogs"
import { createKit, THEME, type Ui } from "./kit"
import { createTableView } from "./table"

export type { Ui }

export function createView(renderer: CliRenderer, store: Store, ui: Ui) {
  const root = new BoxRenderable(renderer, {
    id: "board-root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
  })
  renderer.root.add(root)
  const kit = createKit(renderer, store, ui, root)
  const { text } = kit
  const drawBoard = createBoardView(kit)
  const drawTable = createTableView(kit)
  const detail = createDetailView(kit, draw)
  const dialogs = createDialogs(kit)

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
        ? `esc back · ${arrows.ud} scroll · tab select · space done · enter open · n subtask · u upload · e edit · m menu · ? help`
        : s.view === "table"
          ? `1-4 sort · enter open · n new · / search · m menu · b board · ? help · q quit`
          : `n new · / search · enter open · alt+${arrows.lr} move · alt+${arrows.ud} reorder · m menu · ? help · q quit`
    return fit([{ text: ` ${hints}`, fg: THEME.muted }], W)
  }

  function drawOverlay(s: State, o: Overlay, z: number) {
    switch (o.kind) {
      case "detail":
        return detail.draw(s, o, z)
      case "menu":
        return dialogs.menu(o, z)
      case "picker":
        return dialogs.picker(o, z)
      case "sync":
        return dialogs.sync(o, z)
      case "move":
        return dialogs.move(o, z)
      case "help":
        return dialogs.help(z)
      case "confirm":
        return dialogs.confirm(o, z)
      case "input":
        return // drawn in the footer
    }
  }

  function draw() {
    const s = store.state
    const W = renderer.width
    const H = renderer.height
    for (const child of root.getChildren()) child.destroyRecursively()
    detail.prune(s)
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
