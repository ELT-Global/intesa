import { afterEach, describe, expect, it } from "bun:test"
import { ensureSyntaxTree } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { createMarkdownEditorExtensions } from "../index"

function createTestView(doc: string, cursor = doc.length) {
  const parent = document.createElement("div")
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: createMarkdownEditorExtensions(),
  })
  ensureSyntaxTree(state, state.doc.length, 1000)
  const view = new EditorView({ state, parent })
  return { view, parent }
}

const doc = (...lines: string[]) => lines.join("\n")
const cells = (parent: HTMLElement, selector: string) =>
  [...parent.querySelectorAll<HTMLElement>(selector)].map((c) => c.textContent)

afterEach(() => {
  document.body.innerHTML = ""
})

describe("tables — rendered", () => {
  const table = doc(
    "intro",
    "",
    "| Name | Qty | Note |",
    "| :--- | ---: | :-: |",
    "| **Apples** | 3 | `fresh` |",
    "| Pears |  | [shop](https://example.com) |",
    "| Plums |",
    "",
    "outro",
  )

  it("renders the header and every row as a table, markers hidden", () => {
    const { parent } = createTestView(table, 0)
    expect(cells(parent, ".cm-lp-table th")).toEqual(["Name", "Qty", "Note"])
    expect(cells(parent, ".cm-lp-table td")).toEqual([
      "Apples",
      "3",
      "fresh",
      "Pears",
      "",
      "shop",
      "Plums",
      "",
      "",
    ])
    expect(parent.textContent).not.toContain("|")
  })

  it("applies the delimiter row's alignment to each column", () => {
    const { parent } = createTestView(table, 0)
    const aligns = [...parent.querySelectorAll<HTMLElement>(".cm-lp-table th")].map(
      (th) => th.style.textAlign,
    )
    expect(aligns).toEqual(["left", "right", "center"])
  })

  it("formats inline markdown inside cells", () => {
    const { parent } = createTestView(table, 0)
    expect(parent.querySelector(".cm-lp-table strong.cm-lp-strong")?.textContent).toBe("Apples")
    expect(parent.querySelector(".cm-lp-table code.cm-lp-code")?.textContent).toBe("fresh")
    expect(parent.querySelector(".cm-lp-table .cm-lp-link")?.textContent).toBe("shop")
  })

  it("keeps an escaped pipe as cell text", () => {
    const { parent } = createTestView(doc("| a \\| b | c |", "| - | - |", "| 1 | 2 |", "", "x"), 0)
    expect(cells(parent, ".cm-lp-table th")).toEqual(["a | b", "c"])
  })

  it("stays rendered while the editor is unfocused, even with the caret inside", () => {
    const { parent } = createTestView(table, table.indexOf("Apples"))
    expect(parent.querySelector(".cm-lp-table")).not.toBeNull()
    expect(parent.querySelector(".cm-lp-table-raw")).toBeNull()
  })

  it("does not change the markdown", () => {
    const { view } = createTestView(table, 0)
    expect(view.state.doc.toString()).toBe(table)
  })
})

describe("tables — left as markdown", () => {
  it("a table nested in a list keeps its markers and is styled as raw lines", () => {
    const nested = doc("- item", "", "  | a | b |", "  | - | - |", "  | 1 | 2 |", "", "outro")
    const { parent } = createTestView(nested)
    expect(parent.querySelector(".cm-lp-table")).toBeNull()
    expect(parent.querySelectorAll(".cm-lp-table-raw")).toHaveLength(3)
  })

  it("pipe text without a delimiter row is not a table", () => {
    const { parent } = createTestView(doc("| a | b |", "| 1 | 2 |"))
    expect(parent.querySelector(".cm-lp-table")).toBeNull()
  })
})
