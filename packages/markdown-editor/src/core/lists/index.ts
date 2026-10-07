import { EditorSelection } from "@codemirror/state"
import { type EditorView, keymap, WidgetType } from "@codemirror/view"

// ---------------------------------------------------------------------------
// Bullet widget
// ---------------------------------------------------------------------------

const BULLET_CHARS = ["•", "◦", "▪"]

export class BulletWidget extends WidgetType {
  constructor(readonly level: number) {
    super()
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span")
    span.className = "cm-lp-bullet"
    span.textContent = BULLET_CHARS[this.level % BULLET_CHARS.length] ?? "•"
    span.setAttribute("aria-hidden", "true")
    return span
  }

  eq(other: BulletWidget): boolean {
    return this.level === other.level
  }

  ignoreEvent(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// Task checkbox widget
// ---------------------------------------------------------------------------

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const cb = document.createElement("input")
    cb.type = "checkbox"
    cb.checked = this.checked
    cb.className = "cm-lp-checkbox"
    cb.setAttribute("aria-label", this.checked ? "Completed task" : "Incomplete task")
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(cb)
      const line = view.state.doc.lineAt(pos)
      const match = line.text.match(/^(\s*[-*+]\s)\[([ xX])\]/)
      if (match) {
        const bracketStart = line.from + (match[1]?.length ?? 0)
        const isChecked = match[2] !== " "
        view.dispatch({
          changes: { from: bracketStart, to: bracketStart + 3, insert: isChecked ? "[ ]" : "[x]" },
          userEvent: "input",
        })
      }
    })
    return cb
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked
  }

  ignoreEvent(): boolean {
    return true
  }
}

// ---------------------------------------------------------------------------
// Ordered list marker widget + formatting helpers
// ---------------------------------------------------------------------------

export function toAlpha(n: number): string {
  let result = ""
  while (n > 0) {
    n--
    result = String.fromCharCode(97 + (n % 26)) + result
    n = Math.floor(n / 26)
  }
  return result
}

export function toRoman(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
  const syms = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"]
  let result = ""
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]!) {
      result += syms[i]
      n -= vals[i]!
    }
  }
  return result
}

export function formatOrderedMarker(num: number, level: number, delim: string): string {
  const tier = level % 3
  if (tier === 0) return `${num}${delim}`
  if (tier === 1) return `${toAlpha(num)}${delim}`
  return `${toRoman(num)}${delim}`
}

export class OrderedMarkerWidget extends WidgetType {
  constructor(readonly label: string) {
    super()
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span")
    span.className = "cm-lp-ordered-marker"
    span.textContent = this.label
    span.setAttribute("aria-hidden", "true")
    return span
  }

  eq(other: OrderedMarkerWidget): boolean {
    return this.label === other.label
  }

  ignoreEvent(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// List commands
// ---------------------------------------------------------------------------

const LIST_MARKER_RE = /^[ \t]*(\d+[.)]\s+|[-*+]\s)/
const LIST_INDENT = "  "
const ORDERED_INDENT = "   "
const ORDERED_NUM_RE = /^(\s*)(\d+)([.)]\s)/

function getListIndent(lineText: string): string {
  return ORDERED_NUM_RE.test(lineText) ? ORDERED_INDENT : LIST_INDENT
}

export function indentListItem(view: EditorView): boolean {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.from)
  if (!LIST_MARKER_RE.test(line.text)) return false

  const indent = getListIndent(line.text)
  const changes: { from: number; to?: number; insert: string }[] = []

  changes.push({ from: line.from, insert: indent })

  const orderedMatch = ORDERED_NUM_RE.exec(line.text)
  if (orderedMatch && orderedMatch[2] !== "1") {
    const numFrom = line.from + (orderedMatch[1]?.length ?? 0)
    const numTo = numFrom + (orderedMatch[2]?.length ?? 0)
    changes.push({ from: numFrom, to: numTo, insert: "1" })
  }

  view.dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }))
  return true
}

export function dedentListItem(view: EditorView): boolean {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.from)
  if (!LIST_MARKER_RE.test(line.text)) return false

  const leadingSpaces = line.text.match(/^(\s*)/)?.[1]?.length ?? 0
  if (leadingSpaces === 0) return true

  const indent = getListIndent(line.text)
  const removeCount = Math.min(leadingSpaces, indent.length)
  view.dispatch(
    state.update({
      changes: { from: line.from, to: line.from + removeCount, insert: "" },
      scrollIntoView: true,
      userEvent: "input",
    }),
  )
  return true
}

const TASK_LINE_RE = /^(\s*[-*+]\s)\[([ xX])\]/

export function toggleCheckbox(view: EditorView): boolean {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.from)
  const match = TASK_LINE_RE.exec(line.text)
  if (!match) return false

  const bracketStart = line.from + (match[1]?.length ?? 0)
  const isChecked = match[2] !== " "
  view.dispatch({
    changes: { from: bracketStart, to: bracketStart + 3, insert: isChecked ? "[ ]" : "[x]" },
    userEvent: "input",
  })
  return true
}

// ---------------------------------------------------------------------------
// List keymap
// ---------------------------------------------------------------------------

export const listKeymap = keymap.of([
  { key: "Tab", run: indentListItem },
  { key: "Shift-Tab", run: dedentListItem },
  { key: "Ctrl-Space", run: toggleCheckbox },
  { key: "Cmd-Space", run: toggleCheckbox },
])
