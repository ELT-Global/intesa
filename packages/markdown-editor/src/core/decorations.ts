import { syntaxTree } from "@codemirror/language"
import type { Range } from "@codemirror/state"
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view"

import { AlertBadgeWidget } from "./blockquotes"
import { BulletWidget, CheckboxWidget, formatOrderedMarker, OrderedMarkerWidget } from "./lists"
import { cursorOnLine, cursorTouches } from "./shared/cursor"

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

export function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const ranges: Range<Decoration>[] = []
  const emphasisHideStack: boolean[] = []

  syntaxTree(state).iterate({
    enter(node) {
      const { name, from, to } = node

      if (name === "Blockquote") {
        const firstLine = state.doc.lineAt(from)
        const alertMatch = firstLine.text.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)
        const alertType = alertMatch?.[1]?.toLowerCase() ?? null

        const lastLine = state.doc.lineAt(Math.max(from, to - 1))
        let inAlertSegment = true
        for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
          const line = state.doc.line(ln)
          if (!line.text.startsWith(">")) {
            inAlertSegment = false
            continue
          }
          ranges.push(
            Decoration.line({
              class:
                alertType && inAlertSegment
                  ? `cm-lp-blockquote cm-lp-alert-${alertType}`
                  : "cm-lp-blockquote",
            }).range(line.from),
          )
        }

        if (alertType && alertMatch) {
          ranges.push(Decoration.line({ class: "cm-lp-alert-title" }).range(firstLine.from))

          const bracketOffset = alertMatch[0].indexOf("[")
          const bracketStart = firstLine.from + bracketOffset
          const bracketEnd = bracketStart + (alertMatch[0].length - bracketOffset)
          const onTitleLine = cursorOnLine(view, firstLine.from)

          if (onTitleLine) {
            ranges.push(
              Decoration.mark({
                class: `cm-lp-alert-badge-ghost cm-lp-alert-badge-${alertType}`,
              }).range(bracketStart, bracketEnd),
            )
          } else {
            ranges.push(
              Decoration.replace({
                widget: new AlertBadgeWidget(alertType),
              }).range(bracketStart, bracketEnd),
            )
          }
        }

        return true
      }

      if (name === "QuoteMark") {
        const onLine = cursorOnLine(view, from)
        let markEnd = to
        if (state.doc.sliceString(to, to + 1) === " ") markEnd++

        if (onLine) {
          ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(from, markEnd))
        } else {
          ranges.push(Decoration.replace({}).range(from, markEnd))
        }
        return false
      }

      if (name === "ATXHeading1" || name === "ATXHeading2" || name === "ATXHeading3") {
        const level = name.at(-1)!
        const onLine = cursorOnLine(view, from)

        let headerMarkEnd = from + parseInt(level) + 1
        const childCursor = node.node.cursor()
        if (childCursor.firstChild()) {
          do {
            if (childCursor.name === "HeaderMark") {
              const line = state.doc.lineAt(from)
              headerMarkEnd = Math.min(childCursor.to + 1, line.to)
              break
            }
          } while (childCursor.nextSibling())
        }

        if (onLine) {
          ranges.push(
            Decoration.mark({ class: `cm-lp-h${level} cm-lp-syntax` }).range(from, headerMarkEnd),
          )
        } else {
          ranges.push(Decoration.replace({}).range(from, headerMarkEnd))
        }

        if (headerMarkEnd < to) {
          ranges.push(Decoration.mark({ class: `cm-lp-h${level}` }).range(headerMarkEnd, to))
        }

        return false
      }

      if (name === "StrongEmphasis") {
        const cursorAway = !cursorTouches(view, from, to)
        emphasisHideStack.push(cursorAway)
        ranges.push(Decoration.mark({ class: "cm-lp-strong" }).range(from, to))
        return true
      }

      if (name === "Emphasis") {
        const cursorAway = !cursorTouches(view, from, to)
        emphasisHideStack.push(cursorAway)
        ranges.push(Decoration.mark({ class: "cm-lp-em" }).range(from, to))
        return true
      }

      if (name === "Strikethrough") {
        const cursorAway = !cursorTouches(view, from, to)
        emphasisHideStack.push(cursorAway)
        ranges.push(Decoration.mark({ class: "cm-lp-strike" }).range(from, to))
        return true
      }

      if (name === "EmphasisMark" || name === "StrikethroughMark") {
        const shouldHide =
          emphasisHideStack.length > 0 && emphasisHideStack[emphasisHideStack.length - 1]
        if (shouldHide) {
          ranges.push(Decoration.replace({}).range(from, to))
        } else {
          ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(from, to))
        }
        return false
      }

      if (name === "InlineCode") {
        const touching = cursorTouches(view, from, to)

        let openMarkEnd = from + 1
        let closeMarkStart = to - 1
        const childCursor = node.node.cursor()
        if (childCursor.firstChild()) {
          let isFirst = true
          do {
            if (childCursor.name === "CodeMark") {
              if (isFirst) {
                openMarkEnd = childCursor.to
                isFirst = false
              } else {
                closeMarkStart = childCursor.from
              }
            }
          } while (childCursor.nextSibling())
        }

        if (touching) {
          ranges.push(Decoration.mark({ class: "cm-lp-code" }).range(from, to))
          ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(from, openMarkEnd))
          ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(closeMarkStart, to))
        } else {
          ranges.push(Decoration.replace({}).range(from, openMarkEnd))
          if (openMarkEnd < closeMarkStart) {
            ranges.push(Decoration.mark({ class: "cm-lp-code" }).range(openMarkEnd, closeMarkStart))
          }
          ranges.push(Decoration.replace({}).range(closeMarkStart, to))
        }
        return false
      }

      if (name === "HorizontalRule") {
        const onLine = cursorOnLine(view, from)
        if (onLine) {
          ranges.push(Decoration.line({ class: "cm-lp-hr cm-lp-hr-raw" }).range(from))
          ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(from, to))
        } else {
          ranges.push(Decoration.line({ class: "cm-lp-hr" }).range(from))
          ranges.push(Decoration.replace({}).range(from, to))
        }
        return false
      }

      if (name === "Link") {
        const rawText = state.doc.sliceString(from, to)
        if (/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i.test(rawText)) {
          return false
        }

        if (/^\[[ xX]\]$/.test(rawText)) {
          return false
        }

        const touching = cursorTouches(view, from, to)
        ranges.push(Decoration.mark({ class: "cm-lp-link" }).range(from, to))

        const text = state.doc.sliceString(from, to)
        const bracketClose = text.indexOf("](")
        if (bracketClose > 0) {
          if (touching) {
            ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(from, from + 1))
            ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(from + bracketClose, to))
          } else {
            ranges.push(Decoration.replace({}).range(from, from + 1))
            ranges.push(Decoration.replace({}).range(from + bracketClose, to))
          }
        }
        return false
      }

      // ── List markers ─────────────────────────────────────────────────────
      if (name === "ListMark") {
        const markText = state.doc.sliceString(from, to)
        const onLine = cursorOnLine(view, from)

        let listDepth = 0
        let parent = node.node.parent
        while (parent) {
          if (parent.name === "BulletList" || parent.name === "OrderedList") {
            listDepth++
          }
          parent = parent.parent
        }
        const level = Math.max(0, listDepth - 1)

        // Bullet list markers: -, *, +
        if (/^[-*+]$/.test(markText)) {
          const rest = state.doc.sliceString(to, Math.min(to + 5, state.doc.length))
          const taskMatch = /^ \[([ xX])\]/.exec(rest)

          if (taskMatch) {
            const isChecked = taskMatch[1] !== " "
            const bracketEnd = to + 4
            const spaceAfter = state.doc.sliceString(bracketEnd, bracketEnd + 1) === " "
            const replaceEnd = spaceAfter ? bracketEnd + 1 : bracketEnd

            if (onLine) {
              const markEnd = state.doc.sliceString(to, to + 1) === " " ? to + 1 : to
              ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(from, markEnd))
              ranges.push(
                Decoration.mark({
                  class: isChecked ? "cm-lp-task-checked" : "cm-lp-task-marker",
                }).range(to + 1, bracketEnd),
              )
            } else {
              ranges.push(
                Decoration.replace({
                  widget: new CheckboxWidget(isChecked),
                }).range(from, replaceEnd),
              )
            }
          } else {
            const spaceAfter = state.doc.sliceString(to, to + 1) === " "
            const replaceEnd = spaceAfter ? to + 1 : to

            if (onLine) {
              ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(from, replaceEnd))
            } else {
              ranges.push(
                Decoration.replace({
                  widget: new BulletWidget(level),
                }).range(from, replaceEnd),
              )
            }
          }
          return false
        }

        // Ordered list markers (1., 2., etc.)
        const orderedMatch = markText.match(/^(\d+)([.)])$/)
        if (orderedMatch) {
          const num = parseInt(orderedMatch[1] ?? "0", 10)
          const delim = (orderedMatch[2] ?? ".") + " "
          const spaceAfter = state.doc.sliceString(to, to + 1) === " "
          const replaceEnd = spaceAfter ? to + 1 : to

          if (level > 0 && !onLine) {
            const label = formatOrderedMarker(num, level, delim)
            ranges.push(
              Decoration.replace({
                widget: new OrderedMarkerWidget(label),
              }).range(from, replaceEnd),
            )
          } else if (onLine) {
            ranges.push(Decoration.mark({ class: "cm-lp-syntax" }).range(from, replaceEnd))
          }
          return false
        }

        return false
      }

      return true
    },

    leave(node) {
      if (
        node.name === "StrongEmphasis" ||
        node.name === "Emphasis" ||
        node.name === "Strikethrough"
      ) {
        emphasisHideStack.pop()
      }
    },
  })

  return Decoration.set(ranges, true)
}

// ---------------------------------------------------------------------------
// Live preview plugin
// ---------------------------------------------------------------------------

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
