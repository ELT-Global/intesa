import { indentLess, indentMore } from "@codemirror/commands"
import { EditorSelection } from "@codemirror/state"
import { type EditorView, keymap } from "@codemirror/view"

import { codeBlockAt, enclosing, fenceMarks } from "../shared/code"

const INDENT = "  "

// Leading whitespace and quote marks, then a run of three or more backticks or tildes.
const FENCE_LINE = /^([ \t]*(?:>[ \t]?)*[ \t]*)(`{3,}|~{3,})[^`]*$/

// ---------------------------------------------------------------------------
// Enter
// ---------------------------------------------------------------------------

/**
 * If the caret ends an unclosed opening fence, insert the closing fence and park the caret
 * between the two.
 */
function closeFence(view: EditorView): boolean {
  const { state } = view
  const caret = state.selection.main
  const block = codeBlockAt(state, caret.head)
  if (!caret.empty || block?.name !== "FencedCode") return false

  const line = state.doc.lineAt(caret.head)
  const marks = fenceMarks(block)
  const opening = marks[0]
  const fence = FENCE_LINE.exec(line.text)
  const isUnclosedOpening =
    marks.length === 1 &&
    opening !== undefined &&
    opening.from >= line.from &&
    opening.to <= line.to
  if (!isUnclosedOpening || !fence || caret.head !== line.to) return false

  const prefix = fence[1] ?? ""
  view.dispatch({
    changes: { from: line.to, insert: `\n${prefix}\n${prefix}${fence[2]}` },
    selection: EditorSelection.cursor(line.to + 1 + prefix.length),
    scrollIntoView: true,
    userEvent: "input",
  })
  return true
}

/** A new line that repeats the indentation (and quote marks, inside a blockquote) left of the caret. */
function continueLine(view: EditorView): boolean {
  const { state } = view
  const caret = state.selection.main
  const line = state.doc.lineAt(caret.head)
  const inQuote = enclosing(state, caret.head, ["Blockquote"]) !== null
  const lead = (inQuote ? /^[ \t]*(?:>[ \t]?)+[ \t]*/ : /^[ \t]*/).exec(line.text)?.[0] ?? ""
  const carried = lead.slice(0, caret.from - line.from)
  view.dispatch(
    state.update(state.replaceSelection(`\n${carried}`), {
      scrollIntoView: true,
      userEvent: "input",
    }),
  )
  return true
}

/**
 * Enter inside code. Closes an unclosed opening fence; elsewhere in a block it keeps the
 * line's indentation and never continues a list or quote, because `- ` or `> ` there is code,
 * not markup.
 */
export function codeBlockEnter(view: EditorView): boolean {
  const { state } = view
  if (state.selection.ranges.length > 1 || !codeBlockAt(state, state.selection.main.head)) {
    return false
  }
  return closeFence(view) || continueLine(view)
}

// ---------------------------------------------------------------------------
// Backspace
// ---------------------------------------------------------------------------

/** Backspace on the empty line between two fences removes the whole empty block. */
export function codeBlockBackspace(view: EditorView): boolean {
  const { state } = view
  const caret = state.selection.main
  const block = caret.empty ? codeBlockAt(state, caret.head) : null
  if (block?.name !== "FencedCode" || fenceMarks(block).length !== 2) return false

  const line = state.doc.lineAt(caret.head)
  const first = state.doc.lineAt(block.from)
  const last = state.doc.lineAt(block.to)
  const isEmptyMiddleLine =
    line.length === 0 && last.number - first.number === 2 && line.number === first.number + 1
  if (!isEmptyMiddleLine) return false

  view.dispatch({
    changes: { from: block.from, to: block.to, insert: "" },
    selection: EditorSelection.cursor(block.from),
    scrollIntoView: true,
    userEvent: "delete.backward",
  })
  return true
}

// ---------------------------------------------------------------------------
// Tab / Shift-Tab
// ---------------------------------------------------------------------------

/** Tab in code: a fixed indent at the caret, or every selected line indented. */
export function codeBlockIndent(view: EditorView): boolean {
  const { state } = view
  if (!codeBlockAt(state, state.selection.main.head)) return false
  if (!state.selection.main.empty) return indentMore(view)
  view.dispatch(state.update(state.replaceSelection(INDENT), { userEvent: "input" }))
  return true
}

export function codeBlockDedent(view: EditorView): boolean {
  if (!codeBlockAt(view.state, view.state.selection.main.head)) return false
  return indentLess(view)
}

export const codeBlockKeymap = keymap.of([
  { key: "Enter", run: codeBlockEnter },
  { key: "Backspace", run: codeBlockBackspace },
  { key: "Tab", run: codeBlockIndent },
  { key: "Shift-Tab", run: codeBlockDedent },
])
