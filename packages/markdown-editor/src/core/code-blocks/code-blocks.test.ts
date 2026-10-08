import { afterEach, describe, expect, it } from "bun:test"
import { ensureSyntaxTree } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import {
  codeBlockAt,
  codeBlockBackspace,
  codeBlockDedent,
  codeBlockEnter,
  codeBlockIndent,
  createMarkdownEditorExtensions,
  inCode,
} from "../index"

const FENCE = "```"

function createTestView(doc: string, cursor?: number) {
  const parent = document.createElement("div")
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor ?? doc.length),
      extensions: createMarkdownEditorExtensions(),
    }),
    parent,
  })
  // Make sure the whole document is parsed before asking about nodes.
  ensureSyntaxTree(view.state, view.state.doc.length, 1000)
  return {
    view,
    parent,
    destroy() {
      view.destroy()
      parent.remove()
    },
  }
}

const doc = (...lines: string[]) => lines.join("\n")
const text = (view: EditorView) => view.state.doc.toString()
const at = (view: EditorView, needle: string, after = false) => {
  const i = text(view).indexOf(needle)
  if (i < 0) throw new Error(`"${needle}" not found`)
  return after ? i + needle.length : i
}
const pos = (src: string, needle: string, after = false) => {
  const i = src.indexOf(needle)
  if (i < 0) throw new Error(`"${needle}" not found`)
  return after ? i + needle.length : i
}
const lines = (parent: HTMLElement, selector: string) => parent.querySelectorAll(selector)

afterEach(() => {
  document.body.innerHTML = ""
})

describe("code blocks — live preview", () => {
  const closed = doc("intro", FENCE, "const a = 1", "const b = 2", FENCE, "outro")

  it("styles every line of a closed block and hides the fences while the caret is elsewhere", () => {
    const { parent, destroy } = createTestView(closed, 0)
    expect(lines(parent, ".cm-lp-codeblock").length).toBe(4)
    expect(lines(parent, ".cm-lp-codeblock-first").length).toBe(1)
    expect(lines(parent, ".cm-lp-codeblock-last").length).toBe(1)
    expect(lines(parent, ".cm-lp-codefence-hidden").length).toBe(2)
    expect(lines(parent, ".cm-lp-codefence").length).toBe(0)
    expect(parent.querySelector(".cm-content")?.textContent).not.toContain(FENCE)
    expect(parent.querySelector(".cm-content")?.textContent).toContain("const a = 1")
    destroy()
  })

  it("shows the fences, dimmed, while the caret is inside the block", () => {
    const { view, parent, destroy } = createTestView(closed, 0)
    view.dispatch({ selection: { anchor: at(view, "const a") + 3 } })
    expect(lines(parent, ".cm-lp-codefence").length).toBe(2)
    expect(lines(parent, ".cm-lp-codefence-hidden").length).toBe(0)
    expect(parent.querySelector(".cm-content")?.textContent).toContain(FENCE)
    expect(lines(parent, ".cm-lp-syntax").length).toBe(2)
    destroy()
  })

  it("shows the fences again when a selection reaches into the block", () => {
    const { view, parent, destroy } = createTestView(closed, 0)
    view.dispatch({ selection: { anchor: 0, head: at(view, "const a") + 2 } })
    expect(lines(parent, ".cm-lp-codefence").length).toBe(2)
    destroy()
  })

  it("keeps the opening fence's language text out of sight until the caret arrives", () => {
    const src = doc(`${FENCE}ts`, "let x: number", FENCE, "after")
    const { view, parent, destroy } = createTestView(src, src.length)
    expect(parent.querySelector(".cm-content")?.textContent).not.toContain("ts\n")
    expect(parent.querySelector(".cm-content")?.textContent).not.toContain(`${FENCE}ts`)
    view.dispatch({ selection: { anchor: at(view, "let") } })
    expect(parent.querySelector(".cm-content")?.textContent).toContain(`${FENCE}ts`)
    destroy()
  })

  it("handles an unclosed fence: styled to the end, only the opening fence line is a fence", () => {
    const src = doc("intro", FENCE, "one", "two")
    const { parent, destroy } = createTestView(src, 0)
    expect(lines(parent, ".cm-lp-codeblock").length).toBe(3)
    expect(lines(parent, ".cm-lp-codefence-hidden").length).toBe(1)
    expect(parent.querySelector(".cm-content")?.textContent).toContain("two")
    destroy()
  })

  it("supports tilde fences", () => {
    const src = doc("~~~", "tilde", "~~~", "after")
    const { parent, destroy } = createTestView(src, src.length)
    expect(lines(parent, ".cm-lp-codeblock").length).toBe(3)
    expect(lines(parent, ".cm-lp-codefence-hidden").length).toBe(2)
    destroy()
  })

  it("styles an indented code block without fences", () => {
    const src = doc("para", "", "    indented", "    code", "", "after")
    const { parent, destroy } = createTestView(src, src.length)
    expect(lines(parent, ".cm-lp-codeblock").length).toBe(2)
    expect(lines(parent, ".cm-lp-codefence, .cm-lp-codefence-hidden").length).toBe(0)
    destroy()
  })

  it("does not apply inline or list styling inside the block", () => {
    const src = doc(FENCE, "**not bold**", "- not a bullet", "# not a heading", FENCE, "after")
    const { parent, destroy } = createTestView(src, src.length)
    expect(lines(parent, ".cm-lp-strong").length).toBe(0)
    expect(lines(parent, ".cm-lp-bullet").length).toBe(0)
    expect(lines(parent, ".cm-lp-h1").length).toBe(0)
    expect(parent.querySelector(".cm-content")?.textContent).toContain("**not bold**")
    destroy()
  })

  it("leaves surrounding markdown styled", () => {
    const src = doc("# Title", FENCE, "x", FENCE, "some **bold** text")
    const { parent, destroy } = createTestView(src, src.length)
    expect(lines(parent, ".cm-lp-h1").length).toBeGreaterThan(0)
    expect(lines(parent, ".cm-lp-strong").length).toBe(1)
    destroy()
  })

  it("renders a block nested in a blockquote without clobbering the quote marks", () => {
    const src = doc(`> ${FENCE}`, "> quoted code", `> ${FENCE}`, "after")
    const { parent, destroy } = createTestView(src, src.length)
    expect(lines(parent, ".cm-lp-codeblock").length).toBe(3)
    expect(parent.querySelector(".cm-content")?.textContent).toContain("quoted code")
    destroy()
  })

  it("renders a block nested in a list item", () => {
    const src = doc("- item", `  ${FENCE}`, "  code", `  ${FENCE}`, "after")
    const { parent, destroy } = createTestView(src, src.length)
    expect(lines(parent, ".cm-lp-codeblock").length).toBe(3)
    destroy()
  })
})

describe("code blocks — syntax helpers", () => {
  it("finds the enclosing block and inline code, and nothing elsewhere", () => {
    const src = doc("plain", FENCE, "code", FENCE, "after `inline` end")
    const { view, destroy } = createTestView(src, 0)
    expect(codeBlockAt(view.state, at(view, "code", true))).not.toBeNull()
    expect(codeBlockAt(view.state, at(view, "plain", true))).toBeNull()
    expect(inCode(view.state, at(view, "inline") + 2)).toBe(true)
    expect(inCode(view.state, at(view, "after") + 2)).toBe(false)
    destroy()
  })
})

describe("code blocks — Enter", () => {
  it("closes an unclosed opening fence and parks the caret between the fences", () => {
    const { view, destroy } = createTestView(`${FENCE}js`)
    expect(codeBlockEnter(view)).toBe(true)
    expect(text(view)).toBe(`${FENCE}js\n\n${FENCE}`)
    expect(view.state.selection.main.head).toBe(`${FENCE}js\n`.length)
    destroy()
  })

  it("closes the fence even when more text follows, using the same fence characters", () => {
    const src = doc("~~~~", "", "later paragraph")
    const { view, destroy } = createTestView(src, 4)
    expect(codeBlockEnter(view)).toBe(true)
    expect(text(view)).toBe(doc("~~~~", "", "~~~~", "", "later paragraph"))
    expect(view.state.selection.main.head).toBe(5)
    destroy()
  })

  it("keeps the indentation of an indented fence when closing it", () => {
    const src = doc("- item", `  ${FENCE}`)
    const { view, destroy } = createTestView(src)
    expect(codeBlockEnter(view)).toBe(true)
    expect(text(view)).toBe(doc("- item", `  ${FENCE}`, "  ", `  ${FENCE}`))
    expect(view.state.selection.main.head).toBe(doc("- item", `  ${FENCE}`, "  ").length)
    destroy()
  })

  it("keeps the quote prefix when closing a fence inside a blockquote", () => {
    const { view, destroy } = createTestView(`> ${FENCE}`)
    expect(codeBlockEnter(view)).toBe(true)
    expect(text(view)).toBe(doc(`> ${FENCE}`, "> ", `> ${FENCE}`))
    destroy()
  })

  it("does not add a second closing fence when the block is already closed", () => {
    const src = doc(FENCE, "code", FENCE)
    const { view, destroy } = createTestView(src, FENCE.length)
    expect(codeBlockEnter(view)).toBe(true)
    expect(text(view)).toBe(doc(FENCE, "", "code", FENCE))
    destroy()
  })

  it("keeps the current line's indentation inside a block", () => {
    const src = doc(FENCE, "  indented", FENCE)
    const { view, destroy } = createTestView(src, pos(src, "indented", true))
    expect(codeBlockEnter(view)).toBe(true)
    expect(text(view)).toBe(doc(FENCE, "  indented", "  ", FENCE))
    destroy()
  })

  it("carries only the indentation left of the caret", () => {
    const src = doc(FENCE, "    deep", FENCE)
    const { view, destroy } = createTestView(src, FENCE.length + 1 + 2)
    expect(codeBlockEnter(view)).toBe(true)
    // Two spaces sit left of the caret and are carried; the two to its right just move down.
    expect(text(view)).toBe(doc(FENCE, "  ", "    deep", FENCE))
    destroy()
  })

  it("does not continue list or quote markup written inside a block", () => {
    const src = doc(FENCE, "- not a list", "> not a quote", FENCE)
    const first = createTestView(src, pos(src, "- not a list", true))
    expect(codeBlockEnter(first.view)).toBe(true)
    expect(text(first.view)).toBe(doc(FENCE, "- not a list", "", "> not a quote", FENCE))
    first.destroy()

    const second = createTestView(src, pos(src, "> not a quote", true))
    expect(codeBlockEnter(second.view)).toBe(true)
    expect(text(second.view)).toBe(doc(FENCE, "- not a list", "> not a quote", "", FENCE))
    second.destroy()
  })

  it("replaces a selection with the newline", () => {
    const src = doc(FENCE, "abcdef", FENCE)
    const from = FENCE.length + 1 + 2
    const { view, destroy } = createTestView(src, from)
    view.dispatch({ selection: { anchor: from, head: from + 2 } })
    expect(codeBlockEnter(view)).toBe(true)
    expect(text(view)).toBe(doc(FENCE, "ab", "ef", FENCE))
    destroy()
  })

  it("leaves Enter outside code to the other handlers", () => {
    const { view, destroy } = createTestView("plain text")
    expect(codeBlockEnter(view)).toBe(false)
    expect(text(view)).toBe("plain text")
    destroy()
  })

  it("is wired into the keymap ahead of list continuation", () => {
    const src = doc(FENCE, "- item", FENCE)
    const { view, destroy } = createTestView(src, FENCE.length + 1 + "- item".length)
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(text(view)).toBe(doc(FENCE, "- item", "", FENCE))
    destroy()
  })
})

describe("code blocks — Backspace", () => {
  it("removes an empty block when backspacing on its empty line", () => {
    const src = doc("before", FENCE, "", FENCE, "after")
    const { view, destroy } = createTestView(src, "before\n".length + FENCE.length + 1)
    expect(codeBlockBackspace(view)).toBe(true)
    expect(text(view)).toBe(doc("before", "", "after"))
    expect(view.state.selection.main.head).toBe("before\n".length)
    destroy()
  })

  it("does nothing when the block has content", () => {
    const src = doc(FENCE, "code", FENCE)
    const { view, destroy } = createTestView(src, FENCE.length + 1 + "code".length)
    expect(codeBlockBackspace(view)).toBe(false)
    expect(text(view)).toBe(src)
    destroy()
  })

  it("does nothing outside code or with a selection", () => {
    const outside = createTestView("text")
    expect(codeBlockBackspace(outside.view)).toBe(false)
    outside.destroy()

    const src = doc(FENCE, "", FENCE)
    const { view, destroy } = createTestView(src, FENCE.length + 1)
    view.dispatch({ selection: { anchor: 0, head: FENCE.length + 1 } })
    expect(codeBlockBackspace(view)).toBe(false)
    destroy()
  })

  it("does not remove an unclosed fence", () => {
    const src = doc(FENCE, "")
    const { view, destroy } = createTestView(src)
    expect(codeBlockBackspace(view)).toBe(false)
    destroy()
  })
})

describe("code blocks — Tab and Shift-Tab", () => {
  it("inserts two spaces at the caret inside a block", () => {
    const src = doc(FENCE, "ab", FENCE)
    const { view, destroy } = createTestView(src, FENCE.length + 1 + 1)
    expect(codeBlockIndent(view)).toBe(true)
    expect(text(view)).toBe(doc(FENCE, "a  b", FENCE))
    destroy()
  })

  it("indents every selected line", () => {
    const src = doc(FENCE, "one", "two", FENCE)
    const { view, destroy } = createTestView(src, 0)
    view.dispatch({
      selection: { anchor: FENCE.length + 1, head: FENCE.length + 1 + "one\ntwo".length },
    })
    expect(codeBlockIndent(view)).toBe(true)
    expect(text(view)).toBe(doc(FENCE, "  one", "  two", FENCE))
    destroy()
  })

  it("dedents inside a block", () => {
    const src = doc(FENCE, "    deep", FENCE)
    const { view, destroy } = createTestView(src, FENCE.length + 1 + 4)
    expect(codeBlockDedent(view)).toBe(true)
    expect(text(view)).toBe(doc(FENCE, "  deep", FENCE))
    destroy()
  })

  it("leaves Tab to list indentation outside code", () => {
    const { view, destroy } = createTestView("- item")
    expect(codeBlockIndent(view)).toBe(false)
    expect(codeBlockDedent(view)).toBe(false)
    expect(text(view)).toBe("- item")
    destroy()
  })
})

describe("code blocks — typing rules stay out of code", () => {
  const type = (view: EditorView, chars: string) => {
    for (const ch of chars) {
      view.dispatch(view.state.update(view.state.replaceSelection(ch), { userEvent: "input.type" }))
    }
  }

  it("does not turn -- or -> into typography inside a fenced block", () => {
    const src = doc(FENCE, "", FENCE)
    const { view, destroy } = createTestView(src, FENCE.length + 1)
    type(view, "a -> b -- c")
    expect(text(view)).toBe(doc(FENCE, "a -> b -- c", FENCE))
    destroy()
  })

  it("does not turn -- into a dash inside inline code", () => {
    const { view, destroy } = createTestView("`x ` tail", 3)
    type(view, "--")
    expect(text(view)).toContain("--")
    expect(text(view)).not.toContain("—")
    destroy()
  })

  it("still converts outside code", () => {
    const src = doc(FENCE, "x", FENCE, "")
    const { view, destroy } = createTestView(src)
    type(view, "a -> b")
    expect(text(view)).toContain("a → b")
    destroy()
  })
})

describe("code blocks — more cases", () => {
  it("reveals only the fences of the block the caret is in, and follows the caret", () => {
    const src = doc(FENCE, "one", FENCE, "between", FENCE, "two", FENCE)
    const { view, parent, destroy } = createTestView(src, pos(src, "between"))
    expect(lines(parent, ".cm-lp-codefence-hidden").length).toBe(4)

    view.dispatch({ selection: { anchor: pos(src, "one", true) } })
    expect(lines(parent, ".cm-lp-codefence").length).toBe(2)
    expect(lines(parent, ".cm-lp-codefence-hidden").length).toBe(2)

    view.dispatch({ selection: { anchor: pos(src, "two", true) } })
    expect(lines(parent, ".cm-lp-codefence").length).toBe(2)
    expect(lines(parent, ".cm-lp-codefence-hidden").length).toBe(2)
    destroy()
  })

  it("does not close a fence when Enter is pressed in the middle of the opening line", () => {
    const { view, destroy } = createTestView(`${FENCE}ts`, FENCE.length)
    expect(codeBlockEnter(view)).toBe(true)
    expect(text(view)).toBe(`${FENCE}
ts`)
    destroy()
  })

  it("leaves the block with a plain new line when Enter is pressed after the closing fence", () => {
    const src = doc(FENCE, "code", FENCE)
    const { view, destroy } = createTestView(src)
    expect(codeBlockEnter(view)).toBe(true)
    expect(text(view)).toBe(`${src}
`)
    destroy()
  })

  it("keeps an indented block's lines styled when the surrounding text changes", () => {
    const src = doc("para", "", "    a", "    b")
    const { view, parent, destroy } = createTestView(src, 0)
    view.dispatch({ changes: { from: 0, insert: "more " } })
    expect(lines(parent, ".cm-lp-codeblock").length).toBe(2)
    destroy()
  })
})
