import { deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown"
import { EditorSelection } from "@codemirror/state"
import { type EditorView, keymap, WidgetType } from "@codemirror/view"

import { backspaceUndoInputRule } from "../input-rules"

// ---------------------------------------------------------------------------
// Alert metadata
// ---------------------------------------------------------------------------

export const ALERT_META: Record<string, { label: string; icon: string }> = {
  note: {
    label: "Note",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  },
  tip: {
    label: "Tip",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  },
  important: {
    label: "Important",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
  },
  warning: {
    label: "Warning",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  },
  caution: {
    label: "Caution",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 9-6 6"/><path d="m9 9 6 6"/><path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/></svg>',
  },
}

// ---------------------------------------------------------------------------
// Alert badge widget
// ---------------------------------------------------------------------------

export class AlertBadgeWidget extends WidgetType {
  constructor(readonly alertType: string) {
    super()
  }

  toDOM(): HTMLElement {
    const meta = ALERT_META[this.alertType]
    const wrapper = document.createElement("span")
    if (!meta) return wrapper
    wrapper.className = `cm-lp-alert-badge cm-lp-alert-badge-${this.alertType}`
    wrapper.innerHTML = `${meta.icon}<span class="cm-lp-alert-badge-label">${meta.label}</span>`
    return wrapper
  }

  eq(other: AlertBadgeWidget): boolean {
    return this.alertType === other.alertType
  }

  ignoreEvent(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// Blockquote helpers
// ---------------------------------------------------------------------------

export function isInBlockquote(view: EditorView): boolean {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.from)
  return line.text.startsWith(">")
}

const ALERT_TITLE_RE = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i

export function isAlertTitleLine(lineText: string): boolean {
  return ALERT_TITLE_RE.test(lineText)
}

// Matches lines that carry an explicit list marker: "- ", "* ", "+ ", "1. ", "2) ", etc.
// Used here to delegate Enter on list lines to insertNewlineContinueMarkup.
const LIST_MARKER_RE = /^[ \t]*(\d+[.)]\s+|[-*+]\s)/

// ---------------------------------------------------------------------------
// Blockquote commands
// ---------------------------------------------------------------------------

export function blockquoteEnter(view: EditorView): boolean {
  if (!isInBlockquote(view)) {
    const { state } = view
    const line = state.doc.lineAt(state.selection.main.from)

    if (LIST_MARKER_RE.test(line.text)) {
      return insertNewlineContinueMarkup(view as never)
    }

    view.dispatch(
      state.update(state.replaceSelection("\n"), {
        scrollIntoView: true,
        userEvent: "input",
      }),
    )
    return true
  }

  const { state } = view
  const line = state.doc.lineAt(state.selection.main.from)

  if (isAlertTitleLine(line.text)) {
    return blockquoteContinue(view)
  }

  if (/^>\s*$/.test(line.text)) {
    view.dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: EditorSelection.cursor(line.from),
        scrollIntoView: true,
        userEvent: "input",
      }),
    )
    return true
  }

  view.dispatch(
    state.update(state.replaceSelection("\n"), {
      scrollIntoView: true,
      userEvent: "input",
    }),
  )
  return true
}

export function blockquoteContinue(view: EditorView): boolean {
  if (!isInBlockquote(view)) return false

  view.dispatch(
    view.state.update(view.state.replaceSelection("\n> "), {
      scrollIntoView: true,
      userEvent: "input",
    }),
  )
  return true
}

// ---------------------------------------------------------------------------
// Blockquote keymap
// ---------------------------------------------------------------------------

export const blockquoteKeymap = keymap.of([
  { key: "Enter", run: blockquoteEnter },
  { key: "Shift-Enter", run: blockquoteContinue },
  { key: "Backspace", run: backspaceUndoInputRule },
  { key: "Backspace", run: deleteMarkupBackward as (view: EditorView) => boolean },
])
