import { afterEach, describe, expect, it } from "bun:test"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import {
  backspaceUndoInputRule,
  blockquoteContinue,
  blockquoteEnter,
  createMarkdownEditorExtensions,
  dedentListItem,
  formatOrderedMarker,
  indentListItem,
  insertLink,
  toAlpha,
  toggleCheckbox,
  toRoman,
  wrapSelection,
} from "./index"

function createTestView(doc: string) {
  const parent = document.createElement("div")
  document.body.appendChild(parent)

  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: createMarkdownEditorExtensions(),
    }),
    parent,
  })

  return {
    parent,
    view,
    destroy() {
      view.destroy()
      parent.remove()
    },
  }
}

function setSelection(view: EditorView, anchor: number, head = anchor) {
  view.dispatch({ selection: EditorSelection.range(anchor, head) })
}

function selectText(view: EditorView, text: string) {
  const content = view.state.doc.toString()
  const from = content.indexOf(text)
  if (from === -1) {
    throw new Error(`Could not find "${text}" in "${content}"`)
  }
  setSelection(view, from, from + text.length)
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("markdown-editor-core formatting commands", () => {
  it("wraps and unwraps bold selections", () => {
    const { view, destroy } = createTestView("bold")

    selectText(view, "bold")
    expect(wrapSelection("**")(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("**bold**")
    expect(view.state.selection.main.from).toBe(2)
    expect(view.state.selection.main.to).toBe(6)

    selectText(view, "bold")
    expect(wrapSelection("**")(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("bold")
    expect(view.state.selection.main.from).toBe(0)
    expect(view.state.selection.main.to).toBe(4)

    destroy()
  })

  it("inserts paired markers for empty italic, strikethrough, and code selections", () => {
    const italic = createTestView("")
    expect(wrapSelection("*")(italic.view)).toBe(true)
    expect(italic.view.state.doc.toString()).toBe("**")
    expect(italic.view.state.selection.main.from).toBe(1)
    italic.destroy()

    const strike = createTestView("")
    expect(wrapSelection("~~")(strike.view)).toBe(true)
    expect(strike.view.state.doc.toString()).toBe("~~~~")
    expect(strike.view.state.selection.main.from).toBe(2)
    strike.destroy()

    const code = createTestView("")
    expect(wrapSelection("`")(code.view)).toBe(true)
    expect(code.view.state.doc.toString()).toBe("``")
    expect(code.view.state.selection.main.from).toBe(1)
    code.destroy()
  })

  it("inserts links with and without a selected label", () => {
    const empty = createTestView("")
    expect(insertLink(empty.view)).toBe(true)
    expect(empty.view.state.doc.toString()).toBe("[]()")
    expect(empty.view.state.selection.main.from).toBe(1)
    empty.destroy()

    const selected = createTestView("Meridian")
    selectText(selected.view, "Meridian")
    expect(insertLink(selected.view)).toBe(true)
    expect(selected.view.state.doc.toString()).toBe("[Meridian]()")
    expect(selected.view.state.selection.main.from).toBe("[Meridian](".length)
    selected.destroy()
  })
})

describe("markdown-editor-core blockquote commands", () => {
  it("exits non-empty blockquotes on Enter (no auto-continuation)", () => {
    const { view, destroy } = createTestView("> quote")

    setSelection(view, view.state.doc.length)
    expect(blockquoteEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("> quote\n")

    destroy()
  })

  it("continues blockquotes on Shift+Enter", () => {
    const { view, destroy } = createTestView("> quote")

    setSelection(view, view.state.doc.length)
    expect(blockquoteContinue(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("> quote\n> ")

    destroy()
  })

  it("exits empty blockquote markers cleanly", () => {
    const { view, destroy } = createTestView("> ")

    setSelection(view, view.state.doc.length)
    expect(blockquoteEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("")

    destroy()
  })

  it("delegates non-blockquote Enter to markdown continuation", () => {
    const { view, destroy } = createTestView("- item")

    setSelection(view, view.state.doc.length)
    expect(blockquoteEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("- item\n- ")

    destroy()
  })

  it("does not re-enter a blockquote when typing on the plain line then pressing Enter", () => {
    const { view, destroy } = createTestView("> quote")

    setSelection(view, view.state.doc.length)
    blockquoteEnter(view) // exits to empty plain line
    expect(view.state.doc.toString()).toBe("> quote\n")

    // type something — this becomes a lazy continuation in the markdown AST
    view.dispatch(view.state.update(view.state.replaceSelection("typed"), { userEvent: "input" }))
    expect(view.state.doc.toString()).toBe("> quote\ntyped")

    // Enter on a lazy-continuation line must NOT re-enter the blockquote
    expect(blockquoteEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("> quote\ntyped\n")

    destroy()
  })

  it("does not re-enter a blockquote when Enter is pressed again on the plain line after exiting", () => {
    const { view, destroy } = createTestView("> quote")

    setSelection(view, view.state.doc.length)
    // Step 2: first Enter exits the blockquote into a plain line
    expect(blockquoteEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("> quote\n")

    // Step 3: second Enter on the now-empty plain line must NOT re-enter the blockquote
    expect(blockquoteEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("> quote\n\n")

    destroy()
  })

  it("auto-continues a GFM alert title line on Enter for every alert type", () => {
    for (const type of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
      const { view, destroy } = createTestView(`>[!${type}]`)
      setSelection(view, view.state.doc.length)
      expect(blockquoteEnter(view)).toBe(true)
      expect(view.state.doc.toString()).toBe(`>[!${type}]\n> `)
      destroy()
    }
  })

  it("auto-continues a GFM alert title line that has inline title text on Enter", () => {
    const { view, destroy } = createTestView(">[!NOTE] My Title")
    setSelection(view, view.state.doc.length)
    expect(blockquoteEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(">[!NOTE] My Title\n> ")
    destroy()
  })

  it("auto-continues a GFM alert title line regardless of alert type casing", () => {
    const { view, destroy } = createTestView(">[!important]")
    setSelection(view, view.state.doc.length)
    expect(blockquoteEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(">[!important]\n> ")
    destroy()
  })

  it("does NOT auto-continue regular blockquote continuation lines inside an alert block on Enter", () => {
    const { view, destroy } = createTestView(">[!NOTE]\n> body text")
    setSelection(view, view.state.doc.length)
    expect(blockquoteEnter(view)).toBe(true)
    // cursor on the "body text" line — regular exit behaviour applies
    expect(view.state.doc.toString()).toBe(">[!NOTE]\n> body text\n")
    destroy()
  })

  it("continues regular blockquote lines inside an alert block on Shift+Enter", () => {
    const { view, destroy } = createTestView(">[!NOTE]\n> body text")
    setSelection(view, view.state.doc.length)
    expect(blockquoteContinue(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(">[!NOTE]\n> body text\n> ")
    destroy()
  })
})

describe("markdown-editor-core live preview", () => {
  it("hides heading markers away from the heading line and ghosts them on the line", () => {
    const { parent, view, destroy } = createTestView("# Heading\nBody")

    setSelection(view, view.state.doc.toString().indexOf("Body"))
    expect(parent.textContent).not.toContain("# Heading")
    expect(parent.querySelector(".cm-lp-h1.cm-lp-syntax")).toBeNull()

    setSelection(view, 1)
    expect(parent.textContent).toContain("# Heading")
    expect(parent.querySelector(".cm-lp-h1.cm-lp-syntax")).not.toBeNull()

    destroy()
  })

  it("hides and reveals bold markers based on cursor proximity", () => {
    const { parent, view, destroy } = createTestView("**bold**\nplain")

    setSelection(view, view.state.doc.toString().indexOf("plain"))
    expect(parent.textContent).not.toContain("**")
    expect(parent.querySelector(".cm-lp-strong")).not.toBeNull()

    setSelection(view, 3)
    expect(parent.textContent).toContain("**bold**")
    expect(parent.querySelector(".cm-lp-syntax")).not.toBeNull()

    destroy()
  })

  it("hides and reveals inline code markers based on cursor proximity", () => {
    const { parent, view, destroy } = createTestView("`code`\nplain")

    setSelection(view, view.state.doc.toString().indexOf("plain"))
    expect(parent.textContent).not.toContain("`code`")
    expect(parent.querySelector(".cm-lp-code")).not.toBeNull()

    setSelection(view, 2)
    expect(parent.textContent).toContain("`code`")
    expect(parent.querySelectorAll(".cm-lp-syntax").length).toBeGreaterThan(0)

    destroy()
  })

  it("hides and reveals link syntax based on cursor proximity", () => {
    const { parent, view, destroy } = createTestView("[Meridian](https://example.com)\nplain")

    setSelection(view, view.state.doc.toString().indexOf("plain"))
    expect(parent.textContent).not.toContain("(https://example.com)")
    expect(parent.querySelector(".cm-lp-link")).not.toBeNull()

    setSelection(view, 2)
    expect(parent.textContent).toContain("[Meridian](https://example.com)")
    expect(parent.querySelectorAll(".cm-lp-syntax").length).toBeGreaterThan(0)

    destroy()
  })

  it("hides and reveals blockquote markers based on cursor line", () => {
    const { parent, view, destroy } = createTestView("> quote\nplain")

    setSelection(view, view.state.doc.toString().indexOf("plain"))
    expect(parent.textContent).not.toContain("> quote")

    setSelection(view, 1)
    expect(parent.textContent).toContain("> quote")
    expect(parent.querySelector(".cm-lp-blockquote")).not.toBeNull()

    destroy()
  })

  it("does not bleed alert styling to blockquote lines that follow lazy continuation lines", () => {
    // ">[!IMPORTANT]\n> body\nlazy\n> later" is ONE Blockquote AST node because
    // "lazy" is a lazy-continuation paragraph line. Without a guard, "> later"
    // inherits the alertType derived from the firstLine of that merged node.
    const { parent, view, destroy } = createTestView(">[!IMPORTANT]\n> body\nlazy\n> later")
    setSelection(view, 0)

    // Only the contiguous "> " block before the lazy line should carry alert styling.
    // >[!IMPORTANT] = 1, > body = 1; > later must NOT = 0 extra
    const alertLines = parent.querySelectorAll(".cm-line.cm-lp-alert-important")
    expect(alertLines.length).toBe(2)

    // But > later should still be a plain blockquote
    const allBlockquoteLines = parent.querySelectorAll(".cm-line.cm-lp-blockquote")
    expect(allBlockquoteLines.length).toBeGreaterThanOrEqual(3)

    destroy()
  })

  it("renders alert badges away from the title line and raw markers on the title line", () => {
    const { parent, view, destroy } = createTestView("> [!NOTE] Title\n> detail\nplain")

    setSelection(view, view.state.doc.toString().indexOf("plain"))
    expect(parent.querySelector(".cm-lp-alert-badge-note")).not.toBeNull()
    expect(parent.textContent).not.toContain("[!NOTE]")

    setSelection(view, 3)
    expect(parent.querySelector(".cm-lp-alert-badge-label")).toBeNull()
    expect(parent.querySelector(".cm-lp-alert-badge-ghost.cm-lp-alert-badge-note")).not.toBeNull()
    expect(parent.textContent).toContain("[!NOTE]")

    destroy()
  })

  it("hides horizontal rule markers and shows border when cursor is away", () => {
    const { parent, view, destroy } = createTestView("above\n\n---\nbelow")

    setSelection(view, view.state.doc.toString().indexOf("below"))
    expect(parent.querySelector(".cm-lp-hr")).not.toBeNull()
    // The raw "---" text should be hidden (replaced)
    expect(parent.textContent).not.toContain("---")

    destroy()
  })

  it("shows raw horizontal rule markers when cursor is on the line", () => {
    const { parent, view, destroy } = createTestView("above\n\n---\nbelow")

    setSelection(view, view.state.doc.toString().indexOf("---") + 1)
    expect(parent.querySelector(".cm-lp-hr-raw")).not.toBeNull()
    expect(parent.querySelector(".cm-lp-syntax")).not.toBeNull()
    expect(parent.textContent).toContain("---")

    destroy()
  })
})

// ---------------------------------------------------------------------------
// Input rules
// ---------------------------------------------------------------------------

/** Simulates the user typing one character at a time, which triggers inputRules. */
function typeText(view: EditorView, text: string) {
  for (const char of text) {
    view.dispatch(view.state.update(view.state.replaceSelection(char), { userEvent: "input.type" }))
  }
}

describe("markdown-editor-core input rules — replacements", () => {
  it("replaces -- with an em dash", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "--")
    expect(view.state.doc.toString()).toBe("\u2014")
    destroy()
  })

  it("replaces -> with →", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "->")
    expect(view.state.doc.toString()).toBe("\u2192")
    destroy()
  })

  it("replaces <- with ←", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "<-")
    expect(view.state.doc.toString()).toBe("\u2190")
    destroy()
  })

  it("replaces => with ⇒", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "=>")
    expect(view.state.doc.toString()).toBe("\u21D2")
    destroy()
  })

  it("replaces <= with ⇐", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "<=")
    expect(view.state.doc.toString()).toBe("\u21D0")
    destroy()
  })

  it("replaces != with ≠", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "!=")
    expect(view.state.doc.toString()).toBe("\u2260")
    destroy()
  })

  it("applies the rule mid-document (prefix text is preserved)", () => {
    const { view, destroy } = createTestView("foo ")
    setSelection(view, 4)
    typeText(view, "->")
    expect(view.state.doc.toString()).toBe("foo \u2192")
    destroy()
  })

  it("does not replace a partial pattern", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "-")
    expect(view.state.doc.toString()).toBe("-")
    destroy()
  })

  it("does not replace sequences that match no rule", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "-a")
    expect(view.state.doc.toString()).toBe("-a")
    destroy()
  })

  it("does not fire for non-input.type transactions", () => {
    const { view, destroy } = createTestView("")
    // dispatch without the input.type userEvent — no rule should apply
    view.dispatch(view.state.update(view.state.replaceSelection("->"), {}))
    expect(view.state.doc.toString()).toBe("->")
    destroy()
  })
})

describe("markdown-editor-core input rules — horizontal rule", () => {
  it("typing --- on an empty line produces --- (via em-dash + dash recovery)", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "---")
    // -- becomes em dash, then the third - triggers recovery to "---"
    expect(view.state.doc.toString()).toBe("---")
    destroy()
  })

  it("typing --- on a new line after content produces ---", () => {
    const { view, destroy } = createTestView("hello\n")
    setSelection(view, view.state.doc.length)
    typeText(view, "---")
    expect(view.state.doc.toString()).toBe("hello\n---")
    destroy()
  })

  it("does not convert em-dash + dash in the middle of text", () => {
    const { view, destroy } = createTestView("word")
    setSelection(view, view.state.doc.length)
    typeText(view, "---")
    // After typing "---": "--" becomes em dash first → "word—", then "-" is
    // typed → "word—-".  Because the line is not solely "—-", no conversion
    // should happen.
    expect(view.state.doc.toString()).toBe("word\u2014-")
    destroy()
  })
})

describe("markdown-editor-core input rules — backspace undo", () => {
  it("restores the original sequence on backspace after em dash", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "--")
    expect(view.state.doc.toString()).toBe("\u2014")

    expect(backspaceUndoInputRule(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("--")
    // cursor must be after the last char so further backspaces work normally
    expect(view.state.selection.main.from).toBe(2)
    destroy()
  })

  it("restores -> on backspace after →", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "->")
    expect(backspaceUndoInputRule(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("->")
    expect(view.state.selection.main.from).toBe(2)
    destroy()
  })

  it.each([
    ["--", "—"],
    ["->", "→"],
    ["<-", "←"],
    ["=>", "⇒"],
    ["<=", "⇐"],
    ["!=", "≠"],
  ])("backspace after %s typed as %s restores the original", (original, replacement) => {
    const { view, destroy } = createTestView("")
    typeText(view, original)
    expect(view.state.doc.toString()).toBe(replacement)
    expect(backspaceUndoInputRule(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(original)
    expect(view.state.selection.main.from).toBe(original.length)
    destroy()
  })

  it("returns false and leaves doc unchanged for a normal character", () => {
    const { view, destroy } = createTestView("hello")
    setSelection(view, 5)
    expect(backspaceUndoInputRule(view)).toBe(false)
    expect(view.state.doc.toString()).toBe("hello")
    destroy()
  })

  it("returns false at the start of the document", () => {
    const { view, destroy } = createTestView("")
    expect(backspaceUndoInputRule(view)).toBe(false)
    destroy()
  })

  it("after restoring, a subsequent backspace deletes the last original char normally", () => {
    const { view, destroy } = createTestView("")
    typeText(view, "->") // → (cursor after →)
    backspaceUndoInputRule(view) // -> (cursor after >)

    // next backspace is a plain deletion — must NOT re-trigger our handler
    expect(backspaceUndoInputRule(view)).toBe(false)
    destroy()
  })
})

// ---------------------------------------------------------------------------
// List indent / dedent
// ---------------------------------------------------------------------------

describe("markdown-editor-core list indent (Tab)", () => {
  it("adds two spaces to a bullet list item", () => {
    const { view, destroy } = createTestView("- item")
    setSelection(view, 2)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("  - item")
    destroy()
  })

  it("adds two spaces to a * bullet list item", () => {
    const { view, destroy } = createTestView("* item")
    setSelection(view, 2)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("  * item")
    destroy()
  })

  it("adds two spaces to a + bullet list item", () => {
    const { view, destroy } = createTestView("+ item")
    setSelection(view, 2)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("  + item")
    destroy()
  })

  it("indents an already indented item further", () => {
    const { view, destroy } = createTestView("  - item")
    setSelection(view, 4)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("    - item")
    destroy()
  })

  it("adds three spaces to an ordered list item", () => {
    const { view, destroy } = createTestView("1. item")
    setSelection(view, 3)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("   1. item")
    destroy()
  })

  it("resets ordered list number to 1 when indenting", () => {
    const { view, destroy } = createTestView("3. item")
    setSelection(view, 3)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("   1. item")
    destroy()
  })

  it("keeps number 1 unchanged when indenting", () => {
    const { view, destroy } = createTestView("1. item")
    setSelection(view, 3)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("   1. item")
    destroy()
  })

  it("resets multi-digit number to 1", () => {
    const { view, destroy } = createTestView("12. item")
    setSelection(view, 4)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("   1. item")
    destroy()
  })

  it("handles ordered list with ) marker", () => {
    const { view, destroy } = createTestView("3) item")
    setSelection(view, 3)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("   1) item")
    destroy()
  })

  it("indents a task list item", () => {
    const { view, destroy } = createTestView("- [ ] task")
    setSelection(view, 6)
    expect(indentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("  - [ ] task")
    destroy()
  })

  it("returns false for non-list lines", () => {
    const { view, destroy } = createTestView("plain text")
    setSelection(view, 5)
    expect(indentListItem(view)).toBe(false)
    expect(view.state.doc.toString()).toBe("plain text")
    destroy()
  })

  it("returns false for a heading line", () => {
    const { view, destroy } = createTestView("# heading")
    setSelection(view, 2)
    expect(indentListItem(view)).toBe(false)
    destroy()
  })

  it("returns false on empty document", () => {
    const { view, destroy } = createTestView("")
    expect(indentListItem(view)).toBe(false)
    destroy()
  })
})

describe("markdown-editor-core list dedent (Shift-Tab)", () => {
  it("removes two spaces from an indented bullet item", () => {
    const { view, destroy } = createTestView("  - item")
    setSelection(view, 4)
    expect(dedentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("- item")
    destroy()
  })

  it("removes only available spaces (1 space)", () => {
    const { view, destroy } = createTestView(" - item")
    setSelection(view, 3)
    expect(dedentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("- item")
    destroy()
  })

  it("swallows key at root level (no indentation)", () => {
    const { view, destroy } = createTestView("- item")
    setSelection(view, 2)
    expect(dedentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("- item")
    destroy()
  })

  it("removes two spaces from deeply indented item", () => {
    const { view, destroy } = createTestView("    - item")
    setSelection(view, 6)
    expect(dedentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("  - item")
    destroy()
  })

  it("removes three spaces from indented ordered list", () => {
    const { view, destroy } = createTestView("   1. item")
    setSelection(view, 6)
    expect(dedentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("1. item")
    destroy()
  })

  it("dedents a task list item", () => {
    const { view, destroy } = createTestView("  - [x] task")
    setSelection(view, 8)
    expect(dedentListItem(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("- [x] task")
    destroy()
  })

  it("returns false for non-list lines", () => {
    const { view, destroy } = createTestView("  plain text")
    setSelection(view, 5)
    expect(dedentListItem(view)).toBe(false)
    destroy()
  })
})

// ---------------------------------------------------------------------------
// Checkbox toggle
// ---------------------------------------------------------------------------

describe("markdown-editor-core toggle checkbox (Ctrl+Space)", () => {
  it("toggles unchecked to checked", () => {
    const { view, destroy } = createTestView("- [ ] task")
    setSelection(view, 6)
    expect(toggleCheckbox(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("- [x] task")
    destroy()
  })

  it("toggles checked to unchecked", () => {
    const { view, destroy } = createTestView("- [x] task")
    setSelection(view, 6)
    expect(toggleCheckbox(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("- [ ] task")
    destroy()
  })

  it("toggles uppercase X to unchecked", () => {
    const { view, destroy } = createTestView("- [X] task")
    setSelection(view, 6)
    expect(toggleCheckbox(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("- [ ] task")
    destroy()
  })

  it("toggles indented task list item", () => {
    const { view, destroy } = createTestView("  - [ ] nested")
    setSelection(view, 8)
    expect(toggleCheckbox(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("  - [x] nested")
    destroy()
  })

  it("toggles with * marker", () => {
    const { view, destroy } = createTestView("* [ ] task")
    setSelection(view, 6)
    expect(toggleCheckbox(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("* [x] task")
    destroy()
  })

  it("toggles with + marker", () => {
    const { view, destroy } = createTestView("+ [x] task")
    setSelection(view, 6)
    expect(toggleCheckbox(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("+ [ ] task")
    destroy()
  })

  it("returns false for non-task list lines", () => {
    const { view, destroy } = createTestView("- regular item")
    setSelection(view, 5)
    expect(toggleCheckbox(view)).toBe(false)
    destroy()
  })

  it("returns false for ordered list lines", () => {
    const { view, destroy } = createTestView("1. item")
    setSelection(view, 3)
    expect(toggleCheckbox(view)).toBe(false)
    destroy()
  })

  it("returns false for plain text", () => {
    const { view, destroy } = createTestView("plain text")
    setSelection(view, 5)
    expect(toggleCheckbox(view)).toBe(false)
    destroy()
  })
})

// ---------------------------------------------------------------------------
// Live preview — list decorations
// ---------------------------------------------------------------------------

describe("markdown-editor-core live preview — bullet lists", () => {
  it("replaces - marker with bullet widget when cursor is away", () => {
    const { parent, view, destroy } = createTestView("- item\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    expect(parent.querySelector(".cm-lp-bullet")).not.toBeNull()
    expect(parent.querySelector(".cm-lp-bullet")!.textContent).toBe("•")
    destroy()
  })

  it("shows raw - marker with ghost styling when cursor is on line", () => {
    const { parent, view, destroy } = createTestView("- item\nplain")
    setSelection(view, 2)

    expect(parent.querySelector(".cm-lp-bullet")).toBeNull()
    expect(parent.querySelector(".cm-lp-syntax")).not.toBeNull()
    expect(parent.textContent).toContain("- item")
    destroy()
  })

  it("replaces * marker with bullet widget when cursor is away", () => {
    const { parent, view, destroy } = createTestView("* item\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    expect(parent.querySelector(".cm-lp-bullet")).not.toBeNull()
    destroy()
  })

  it("replaces + marker with bullet widget when cursor is away", () => {
    const { parent, view, destroy } = createTestView("+ item\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    expect(parent.querySelector(".cm-lp-bullet")).not.toBeNull()
    destroy()
  })

  it("uses different bullet chars for nested levels", () => {
    const { parent, view, destroy } = createTestView("- top\n  - nested\n    - deep\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    const bullets = parent.querySelectorAll(".cm-lp-bullet")
    expect(bullets.length).toBe(3)
    expect(bullets[0]?.textContent).toBe("•") // level 0
    expect(bullets[1]?.textContent).toBe("◦") // level 1
    expect(bullets[2]?.textContent).toBe("▪") // level 2
    destroy()
  })
})

describe("markdown-editor-core live preview — task lists", () => {
  it("replaces unchecked task marker with checkbox when cursor is away", () => {
    const { parent, view, destroy } = createTestView("- [ ] task\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    const checkbox = parent.querySelector(".cm-lp-checkbox") as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(false)
    destroy()
  })

  it("replaces checked task marker with checked checkbox when cursor is away", () => {
    const { parent, view, destroy } = createTestView("- [x] task\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    const checkbox = parent.querySelector(".cm-lp-checkbox") as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(true)
    destroy()
  })

  it("shows raw task syntax when cursor is on line", () => {
    const { parent, view, destroy } = createTestView("- [ ] task\nplain")
    setSelection(view, 3)

    expect(parent.querySelector(".cm-lp-checkbox")).toBeNull()
    expect(parent.textContent).toContain("- [ ] task")
    destroy()
  })

  it("does not apply link styling to [x] task markers", () => {
    const { parent, view, destroy } = createTestView("- [x] task\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    // The [x] should be rendered as checkbox, not as a link
    expect(parent.querySelector(".cm-lp-checkbox")).not.toBeNull()
    destroy()
  })

  it("renders uppercase [X] as checked checkbox", () => {
    const { parent, view, destroy } = createTestView("- [X] task\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    const checkbox = parent.querySelector(".cm-lp-checkbox") as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(true)
    destroy()
  })
})

// ---------------------------------------------------------------------------
// Enter continues list items (existing behavior preserved)
// ---------------------------------------------------------------------------

describe("markdown-editor-core list continuation on Enter", () => {
  it("continues a bullet list on Enter", () => {
    const { view, destroy } = createTestView("- item")
    setSelection(view, view.state.doc.length)
    blockquoteEnter(view)
    expect(view.state.doc.toString()).toBe("- item\n- ")
    destroy()
  })

  it("continues a numbered list on Enter", () => {
    const { view, destroy } = createTestView("1. item")
    setSelection(view, view.state.doc.length)
    blockquoteEnter(view)
    expect(view.state.doc.toString()).toBe("1. item\n2. ")
    destroy()
  })

  it("continues an indented list on Enter", () => {
    const { view, destroy } = createTestView("  - item")
    setSelection(view, view.state.doc.length)
    blockquoteEnter(view)
    expect(view.state.doc.toString()).toBe("  - item\n  - ")
    destroy()
  })

  it("continues a task list on Enter", () => {
    const { view, destroy } = createTestView("- [ ] task")
    setSelection(view, view.state.doc.length)
    blockquoteEnter(view)
    expect(view.state.doc.toString()).toBe("- [ ] task\n- [ ] ")
    destroy()
  })
})

// ---------------------------------------------------------------------------
// Edge cases: lists combined with other markdown features
// ---------------------------------------------------------------------------

describe("markdown-editor-core list edge cases", () => {
  it("indent and dedent are inverse operations", () => {
    const { view, destroy } = createTestView("- item")
    setSelection(view, 2)

    indentListItem(view)
    expect(view.state.doc.toString()).toBe("  - item")

    dedentListItem(view)
    expect(view.state.doc.toString()).toBe("- item")
    destroy()
  })

  it("multiple indents stack correctly", () => {
    const { view, destroy } = createTestView("- item")
    setSelection(view, 2)

    indentListItem(view)
    indentListItem(view)
    indentListItem(view)
    expect(view.state.doc.toString()).toBe("      - item")
    destroy()
  })

  it("toggle checkbox twice returns to original state", () => {
    const { view, destroy } = createTestView("- [ ] task")
    setSelection(view, 6)

    toggleCheckbox(view)
    expect(view.state.doc.toString()).toBe("- [x] task")

    toggleCheckbox(view)
    expect(view.state.doc.toString()).toBe("- [ ] task")
    destroy()
  })

  it("indent preserves task marker", () => {
    const { view, destroy } = createTestView("- [x] done")
    setSelection(view, 6)

    indentListItem(view)
    expect(view.state.doc.toString()).toBe("  - [x] done")
    destroy()
  })

  it("dedent preserves task marker", () => {
    const { view, destroy } = createTestView("  - [ ] task")
    setSelection(view, 8)

    dedentListItem(view)
    expect(view.state.doc.toString()).toBe("- [ ] task")
    destroy()
  })

  it("list after heading renders correctly", () => {
    const { parent, view, destroy } = createTestView("# Title\n- item\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    expect(parent.querySelector(".cm-lp-bullet")).not.toBeNull()
    expect(parent.querySelector(".cm-lp-h1")).not.toBeNull()
    destroy()
  })

  it("handles list items with bold text", () => {
    const { parent, view, destroy } = createTestView("- **bold** item\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    expect(parent.querySelector(".cm-lp-bullet")).not.toBeNull()
    expect(parent.querySelector(".cm-lp-strong")).not.toBeNull()
    destroy()
  })

  it("handles list items with inline code", () => {
    const { parent, view, destroy } = createTestView("- `code` item\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    expect(parent.querySelector(".cm-lp-bullet")).not.toBeNull()
    expect(parent.querySelector(".cm-lp-code")).not.toBeNull()
    destroy()
  })

  it("handles list items with links", () => {
    const { parent, view, destroy } = createTestView("- [link](url) item\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    expect(parent.querySelector(".cm-lp-bullet")).not.toBeNull()
    expect(parent.querySelector(".cm-lp-link")).not.toBeNull()
    destroy()
  })

  it("mixed bullet and numbered lists coexist", () => {
    const { parent, view, destroy } = createTestView("- bullet\n1. number\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    // Bullet gets widget, numbered stays as-is
    expect(parent.querySelector(".cm-lp-bullet")).not.toBeNull()
    destroy()
  })

  it("empty list item with just marker still gets bullet", () => {
    const { parent, view, destroy } = createTestView("- \nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    expect(parent.querySelector(".cm-lp-bullet")).not.toBeNull()
    destroy()
  })
})

// ---------------------------------------------------------------------------
// Ordered list marker formatting helpers
// ---------------------------------------------------------------------------

describe("toAlpha", () => {
  it.each([
    [1, "a"],
    [2, "b"],
    [26, "z"],
    [27, "aa"],
    [28, "ab"],
    [52, "az"],
    [53, "ba"],
  ])("converts %d to %s", (n, expected) => expect(toAlpha(n)).toBe(expected))
})

describe("toRoman", () => {
  it.each([
    [1, "i"],
    [2, "ii"],
    [3, "iii"],
    [4, "iv"],
    [5, "v"],
    [9, "ix"],
    [10, "x"],
    [14, "xiv"],
    [40, "xl"],
    [50, "l"],
    [100, "c"],
    [1994, "mcmxciv"],
  ])("converts %d to %s", (n, expected) => expect(toRoman(n)).toBe(expected))
})

describe("formatOrderedMarker", () => {
  it("uses numbers at level 0", () => {
    expect(formatOrderedMarker(1, 0, ". ")).toBe("1. ")
    expect(formatOrderedMarker(3, 0, ". ")).toBe("3. ")
  })

  it("uses lowercase letters at level 1", () => {
    expect(formatOrderedMarker(1, 1, ". ")).toBe("a. ")
    expect(formatOrderedMarker(3, 1, ". ")).toBe("c. ")
  })

  it("uses roman numerals at level 2", () => {
    expect(formatOrderedMarker(1, 2, ". ")).toBe("i. ")
    expect(formatOrderedMarker(4, 2, ". ")).toBe("iv. ")
  })

  it("cycles back to numbers at level 3", () => {
    expect(formatOrderedMarker(2, 3, ". ")).toBe("2. ")
  })

  it("cycles back to letters at level 4", () => {
    expect(formatOrderedMarker(1, 4, ". ")).toBe("a. ")
  })

  it("works with ) delimiter", () => {
    expect(formatOrderedMarker(1, 1, ") ")).toBe("a) ")
    expect(formatOrderedMarker(3, 2, ") ")).toBe("iii) ")
  })
})

// ---------------------------------------------------------------------------
// Live preview — ordered list markers
// ---------------------------------------------------------------------------

describe("markdown-editor-core live preview — ordered lists", () => {
  it("root-level ordered marker stays as-is when cursor is away", () => {
    const { parent, view, destroy } = createTestView("1. first\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    // No widget at level 0 — the raw number is shown
    expect(parent.querySelector(".cm-lp-ordered-marker")).toBeNull()
    expect(parent.textContent).toContain("first")
    destroy()
  })

  it("shows ghost syntax for root-level ordered marker when cursor is on line", () => {
    const { parent, view, destroy } = createTestView("1. first\nplain")
    setSelection(view, 2)

    expect(parent.querySelector(".cm-lp-syntax")).not.toBeNull()
    destroy()
  })

  it("renders indented ordered marker as alphabetic at level 1", () => {
    const { parent, view, destroy } = createTestView("1. top\n   1. nested\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    const marker = parent.querySelector(".cm-lp-ordered-marker")
    expect(marker).not.toBeNull()
    expect(marker!.textContent).toBe("a. ")
    destroy()
  })

  it("renders double-indented ordered marker as roman at level 2", () => {
    const { parent, view, destroy } = createTestView("1. top\n   1. mid\n      1. deep\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    const markers = parent.querySelectorAll(".cm-lp-ordered-marker")
    // level 1 → alpha, level 2+ → roman
    const texts = Array.from(markers).map((m) => m.textContent)
    expect(texts).toContain("a. ")
    expect(texts).toContain("i. ")
    destroy()
  })

  it("shows raw marker when cursor is on indented ordered line", () => {
    const { parent, view, destroy } = createTestView("1. top\n   1. nested\nplain")
    setSelection(view, view.state.doc.toString().indexOf("nested"))

    // cursor on the nested line — should show raw marker, no widget
    expect(parent.querySelector(".cm-lp-ordered-marker")).toBeNull()
    expect(parent.textContent).toContain("1.")
    destroy()
  })

  it("renders correct number in alpha format (3rd item = c)", () => {
    const { parent, view, destroy } = createTestView("1. top\n   3. third\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    const marker = parent.querySelector(".cm-lp-ordered-marker")
    expect(marker).not.toBeNull()
    expect(marker!.textContent).toBe("c. ")
    destroy()
  })

  it("handles ) delimiter in ordered markers", () => {
    const { parent, view, destroy } = createTestView("1) top\n   2) second\nplain")
    setSelection(view, view.state.doc.toString().indexOf("plain"))

    const marker = parent.querySelector(".cm-lp-ordered-marker")
    expect(marker).not.toBeNull()
    expect(marker!.textContent).toBe("b) ")
    destroy()
  })
})
