import type { Range } from "@codemirror/state"
import { Decoration, type EditorView } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"

import { fenceMarks } from "../shared/code"
import { cursorTouches } from "../shared/cursor"

/**
 * Styles a fenced or indented code block: every line carries the band, and the fence lines are
 * dimmed while the caret is inside the block and collapsed to a thin cap otherwise.
 */
export function decorateCodeBlock(
  view: EditorView,
  block: SyntaxNode,
  ranges: Range<Decoration>[],
): void {
  const { doc } = view.state
  const fenced = block.name === "FencedCode"
  const marks = fenced ? fenceMarks(block) : []
  const openMark = marks[0]
  const closeMark = marks.length > 1 ? marks[marks.length - 1] : undefined
  const first = doc.lineAt(block.from)
  const last = doc.lineAt(Math.max(block.from, block.to - 1))
  const showFences = !fenced || cursorTouches(view, block.from, block.to)

  for (let n = first.number; n <= last.number; n++) {
    const line = doc.line(n)
    const fence = n === first.number ? openMark : n === last.number ? closeMark : undefined

    let cls = "cm-lp-codeblock"
    if (n === first.number) cls += " cm-lp-codeblock-first"
    if (n === last.number) cls += " cm-lp-codeblock-last"
    if (fence) cls += showFences ? " cm-lp-codefence" : " cm-lp-codefence-hidden"
    ranges.push(Decoration.line({ class: cls }).range(line.from))

    // From the backticks to the end of the line, so the language tag goes with them.
    if (fence && fence.from < line.to) {
      const deco = showFences ? Decoration.mark({ class: "cm-lp-syntax" }) : Decoration.replace({})
      ranges.push(deco.range(fence.from, line.to))
    }
  }
}
