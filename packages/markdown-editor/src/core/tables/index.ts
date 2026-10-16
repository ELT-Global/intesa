import { syntaxTree } from "@codemirror/language"
import {
  EditorSelection,
  type EditorState,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Align = "left" | "center" | "right" | null

/** Inline content of a cell: plain text, or a formatting element around more content. */
type Inline = string | { tag: string; className: string; children: Inline[] }

interface Cell {
  /** Where a click on the cell puts the caret, relative to the start of the table. */
  offset: number
  content: Inline[]
}

interface TableModel {
  align: Align[]
  header: Cell[]
  rows: Cell[][]
}

const FORMATTING: Record<string, { tag: string; className: string }> = {
  StrongEmphasis: { tag: "strong", className: "cm-lp-strong" },
  Emphasis: { tag: "em", className: "cm-lp-em" },
  Strikethrough: { tag: "s", className: "cm-lp-strike" },
  InlineCode: { tag: "code", className: "cm-lp-code" },
  Link: { tag: "span", className: "cm-lp-link" },
  Autolink: { tag: "span", className: "cm-lp-link" },
}

const MARKUP = new Set(["EmphasisMark", "StrikethroughMark", "CodeMark", "LinkMark"])

/** The text and formatting inside `node`, without the markdown markers. */
function inlineContent(state: EditorState, node: SyntaxNode): Inline[] {
  const out: Inline[] = []
  let pos = node.from
  // A link or image shows only its label: everything from the "]" on is the destination.
  const labelled = node.name === "Link" || node.name === "Image"
  const end = labelled ? (node.getChildren("LinkMark")[1]?.from ?? node.to) : node.to
  for (let child = node.firstChild; child && child.from < end; child = child.nextSibling) {
    if (child.from > pos) out.push(state.sliceDoc(pos, child.from))
    pos = child.to
    if (MARKUP.has(child.name)) continue
    if (child.name === "Escape") {
      out.push(state.sliceDoc(child.from + 1, child.to))
      continue
    }
    const format = FORMATTING[child.name]
    const children = inlineContent(state, child)
    out.push(format ? { ...format, children } : { tag: "span", className: "", children })
  }
  if (pos < end) out.push(state.sliceDoc(pos, end))
  return out
}

/** The cells of a header or body row, empty ones included, in column order. */
function rowCells(state: EditorState, row: SyntaxNode, tableFrom: number): Cell[] {
  const cells: Cell[] = []
  let start = row.from
  let cell: SyntaxNode | null = null
  const close = (to: number) => {
    // Text before a leading pipe is not a cell.
    if (cells.length === 0 && !cell && state.sliceDoc(start, to).trim() === "") return
    cells.push({
      offset: (cell?.from ?? Math.min(start + 1, to)) - tableFrom,
      content: cell ? inlineContent(state, cell) : [],
    })
  }
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableCell") {
      cell = child
      continue
    }
    close(child.from)
    start = child.to
    cell = null
  }
  if (cell || state.sliceDoc(start, row.to).trim() !== "") close(row.to)
  return cells
}

function alignments(delimiterRow: string): Align[] {
  return delimiterRow
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((spec) => {
      const s = spec.trim()
      const left = s.startsWith(":")
      const right = s.endsWith(":")
      return left && right ? "center" : right ? "right" : left ? "left" : null
    })
}

function tableModel(state: EditorState, table: SyntaxNode): TableModel {
  const header = table.getChild("TableHeader")
  const delimiter = table.getChild("TableDelimiter")
  const headerCells = header ? rowCells(state, header, table.from) : []
  const width = headerCells.length
  const fit = (cells: Cell[], rowFrom: number): Cell[] =>
    Array.from(
      { length: width },
      (_, i) => cells[i] ?? { offset: rowFrom - table.from, content: [] },
    )
  return {
    align: delimiter ? alignments(state.sliceDoc(delimiter.from, delimiter.to)) : [],
    header: headerCells,
    rows: table.getChildren("TableRow").map((row) => fit(rowCells(state, row, table.from), row.to)),
  }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function appendInline(parent: HTMLElement, content: Inline[]) {
  for (const item of content) {
    if (typeof item === "string") {
      parent.append(item)
      continue
    }
    const el = document.createElement(item.tag)
    if (item.className) el.className = item.className
    appendInline(el, item.children)
    parent.append(el)
  }
}

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly model: TableModel,
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div")
    wrap.className = "cm-lp-table-wrap"
    const table = document.createElement("table")
    table.className = "cm-lp-table"

    const row = (cells: Cell[], tag: "th" | "td") => {
      const tr = document.createElement("tr")
      cells.forEach((cell, i) => {
        const el = document.createElement(tag)
        const align = this.model.align[i]
        if (align) el.style.textAlign = align
        el.dataset.offset = String(cell.offset)
        appendInline(el, cell.content)
        tr.append(el)
      })
      return tr
    }

    const thead = document.createElement("thead")
    thead.append(row(this.model.header, "th"))
    const tbody = document.createElement("tbody")
    for (const cells of this.model.rows) tbody.append(row(cells, "td"))
    table.append(thead, tbody)
    wrap.append(table)

    // A click puts the caret in the clicked cell, which reveals the markdown for editing.
    wrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const target =
        e.target instanceof Element ? e.target.closest<HTMLElement>("[data-offset]") : null
      const pos = view.posAtDOM(wrap) + Number(target?.dataset.offset ?? 0)
      view.focus()
      view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true })
    })
    return wrap
  }

  eq(other: TableWidget): boolean {
    return this.source === other.source
  }

  get estimatedHeight(): number {
    return (this.model.rows.length + 1) * 36
  }

  ignoreEvent(): boolean {
    return true
  }
}

// ---------------------------------------------------------------------------
// State field
// ---------------------------------------------------------------------------

const setFocused = StateEffect.define<boolean>()

interface TablesState {
  focused: boolean
  decorations: DecorationSet
}

/** Tables nested in a list or quote stay as markdown: a block widget would swallow their markers. */
function renderable(table: SyntaxNode): boolean {
  return table.parent?.name === "Document"
}

/**
 * True when a table shows as its markdown: the editor has focus and the selection touches it.
 * An unfocused editor reads as a document, so its tables stay rendered wherever the caret is.
 */
function revealed(state: EditorState, table: SyntaxNode, focused: boolean): boolean {
  if (!renderable(table)) return true
  return focused && state.selection.ranges.some((r) => r.from <= table.to && r.to >= table.from)
}

export function tableRevealed(state: EditorState, table: SyntaxNode): boolean {
  return revealed(state, table, state.field(tablesField, false)?.focused ?? false)
}

function buildTables(state: EditorState, focused: boolean): DecorationSet {
  const ranges: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return true
      const table = node.node
      if (revealed(state, table, focused)) return false
      const from = state.doc.lineAt(table.from).from
      const to = state.doc.lineAt(table.to).to
      const widget = new TableWidget(state.sliceDoc(from, to), tableModel(state, table))
      ranges.push(Decoration.replace({ widget, block: true }).range(from, to))
      return false
    },
  })
  return Decoration.set(ranges)
}

/** Block widgets cannot come from a view plugin, so rendered tables live in a state field. */
export const tablesField = StateField.define<TablesState>({
  create: (state) => ({ focused: false, decorations: buildTables(state, false) }),
  update(value, tr) {
    let focused = value.focused
    for (const e of tr.effects) if (e.is(setFocused)) focused = e.value
    const stale =
      tr.docChanged ||
      tr.selection !== undefined ||
      focused !== value.focused ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    return stale ? { focused, decorations: buildTables(tr.state, focused) } : value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
})

export const tables = [
  tablesField,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
]

/** Raw table lines while editing: monospace so the columns line up, pipes receding. */
export function decorateRawTable(
  state: EditorState,
  table: SyntaxNode,
  ranges: Range<Decoration>[],
): void {
  const first = state.doc.lineAt(table.from).number
  const last = state.doc.lineAt(table.to).number
  for (let n = first; n <= last; n++) {
    ranges.push(Decoration.line({ class: "cm-lp-table-raw" }).range(state.doc.line(n).from))
  }
  const syntax = Decoration.mark({ class: "cm-lp-syntax" })
  syntaxTree(state).iterate({
    from: table.from,
    to: table.to,
    enter(node) {
      if (node.name === "TableDelimiter") ranges.push(syntax.range(node.from, node.to))
    },
  })
}
