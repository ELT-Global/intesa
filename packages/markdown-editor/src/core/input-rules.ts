import { EditorSelection, EditorState } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"

import { inCode } from "./shared/code"

// ---------------------------------------------------------------------------
// Input rule definitions
// ---------------------------------------------------------------------------

export interface InputRule {
  pattern: RegExp
  replacement: string
  original: string
}

export const INPUT_RULES: InputRule[] = [
  { pattern: /--$/, replacement: "\u2014", original: "--" }, // — em dash
  { pattern: /->$/, replacement: "\u2192", original: "->" }, // → right arrow
  { pattern: /<-$/, replacement: "\u2190", original: "<-" }, // ← left arrow
  { pattern: /=>$/, replacement: "\u21D2", original: "=>" }, // ⇒ right double arrow
  { pattern: /<=$/, replacement: "\u21D0", original: "<=" }, // ⇐ left double arrow
  { pattern: /!=$/, replacement: "\u2260", original: "!=" }, // ≠ not equal
]

// ---------------------------------------------------------------------------
// Transaction filter — auto-replace trigger sequences on input
// ---------------------------------------------------------------------------

export const inputRules = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input.type")) return tr

  const { state } = tr
  const replacements: { from: number; to: number; insert: string }[] = []

  for (const range of state.selection.ranges) {
    if (!range.empty) continue
    const cursor = range.from
    // `--` or `->` in code is code, not typography.
    if (inCode(state, cursor)) continue
    const lookback = state.doc.sliceString(Math.max(0, cursor - 4), cursor)
    for (const rule of INPUT_RULES) {
      const match = lookback.match(rule.pattern)
      if (match) {
        replacements.push({ from: cursor - match[0].length, to: cursor, insert: rule.replacement })
        break
      }
    }
  }

  // em-dash + hyphen on a line by itself → restore to "---" for HorizontalRule
  for (const range of state.selection.ranges) {
    if (!range.empty) continue
    const cursor = range.from
    if (inCode(state, cursor)) continue
    const line = state.doc.lineAt(cursor)
    if (line.text === "\u2014-" || line.text === "\u2014\u2014-") {
      replacements.push({ from: line.from, to: line.to, insert: "---" })
    }
  }

  if (!replacements.length) return tr
  return [tr, { changes: replacements, sequential: true }]
})

// ---------------------------------------------------------------------------
// Backspace undo — restore original sequence for replaced characters
// ---------------------------------------------------------------------------

export function backspaceUndoInputRule(view: EditorView): boolean {
  const { state } = view
  const range = state.selection.main
  if (!range.empty) return false

  const cursor = range.from
  if (cursor === 0) return false

  const charBefore = state.doc.sliceString(cursor - 1, cursor)
  const rule = INPUT_RULES.find((r) => r.replacement === charBefore)
  if (!rule) return false

  view.dispatch({
    changes: { from: cursor - 1, to: cursor, insert: rule.original },
    selection: EditorSelection.cursor(cursor - 1 + rule.original.length),
    userEvent: "delete.backward",
  })
  return true
}
