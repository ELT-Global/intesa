import { EditorSelection } from "@codemirror/state"
import { type EditorView, keymap } from "@codemirror/view"

// ---------------------------------------------------------------------------
// Inline formatting commands
// ---------------------------------------------------------------------------

export function wrapSelection(marker: string) {
  return (view: EditorView): boolean => {
    const mlen = marker.length
    const { state } = view
    const { changes, selection } = state.changeByRange((range) => {
      if (!range.empty) {
        const before = state.doc.sliceString(Math.max(0, range.from - mlen), range.from)
        const after = state.doc.sliceString(range.to, range.to + mlen)
        if (before === marker && after === marker) {
          return {
            changes: [
              { from: range.from - mlen, to: range.from, insert: "" },
              { from: range.to, to: range.to + mlen, insert: "" },
            ],
            range: EditorSelection.range(range.from - mlen, range.to - mlen),
          }
        }
      }

      if (range.empty) {
        return {
          changes: { from: range.from, insert: marker + marker },
          range: EditorSelection.cursor(range.from + mlen),
        }
      }

      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + mlen, range.to + mlen),
      }
    })
    view.dispatch({ changes, selection, scrollIntoView: true, userEvent: "input.format" })
    return true
  }
}

export function insertLink(view: EditorView): boolean {
  const { state } = view
  const { changes, selection } = state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.from, insert: "[]()" },
        range: EditorSelection.cursor(range.from + 1),
      }
    }

    const label = state.doc.sliceString(range.from, range.to)
    return {
      changes: { from: range.from, to: range.to, insert: `[${label}]()` },
      range: EditorSelection.cursor(range.from + label.length + 3),
    }
  })
  view.dispatch({ changes, selection, scrollIntoView: true, userEvent: "input.format" })
  return true
}

// ---------------------------------------------------------------------------
// Formatting keymap
// ---------------------------------------------------------------------------

export const formattingKeymap = keymap.of([
  { key: "Mod-b", run: wrapSelection("**") },
  { key: "Mod-i", run: wrapSelection("*") },
  { key: "Mod-Shift-s", run: wrapSelection("~~") },
  { key: "Mod-e", run: wrapSelection("`") },
  { key: "Mod-k", run: insertLink },
])
