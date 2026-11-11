import type { EditorView } from "@codemirror/view"

// A read-only document has no caret to edit at, so its Markdown is never revealed.

export function cursorTouches(view: EditorView, from: number, to: number): boolean {
  if (view.state.readOnly) return false
  for (const sel of view.state.selection.ranges) {
    if (sel.from <= to && sel.to >= from) return true
  }
  return false
}

export function cursorOnLine(view: EditorView, docPos: number): boolean {
  const { state } = view
  if (state.readOnly) return false
  const line = state.doc.lineAt(docPos).number
  for (const sel of state.selection.ranges) {
    const fromLine = state.doc.lineAt(sel.from).number
    const toLine = sel.empty ? fromLine : state.doc.lineAt(sel.to).number
    if (line >= fromLine && line <= toLine) return true
  }
  return false
}
