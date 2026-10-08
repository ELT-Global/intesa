import { syntaxTree } from "@codemirror/language"
import type { EditorState } from "@codemirror/state"
import type { SyntaxNode } from "@lezer/common"

const BLOCKS = ["FencedCode", "CodeBlock"]

/** The nearest ancestor-or-self of the node at `pos` whose name is in `names`. */
export function enclosing(state: EditorState, pos: number, names: string[]): SyntaxNode | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (names.includes(n.name)) return n
  }
  return null
}

/** The fenced or indented code block containing `pos`, if any. */
export function codeBlockAt(state: EditorState, pos: number): SyntaxNode | null {
  return enclosing(state, pos, BLOCKS)
}

/** True inside a code block or an inline code span. */
export function inCode(state: EditorState, pos: number): boolean {
  return enclosing(state, pos, [...BLOCKS, "InlineCode"]) !== null
}

/** The fence marks of a fenced block: one when it is unclosed, two when closed. */
export function fenceMarks(block: SyntaxNode): { from: number; to: number }[] {
  const marks: { from: number; to: number }[] = []
  for (let child = block.firstChild; child; child = child.nextSibling) {
    if (child.name === "CodeMark") marks.push({ from: child.from, to: child.to })
  }
  return marks
}
