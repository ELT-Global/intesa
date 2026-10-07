import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { EditorView } from "@codemirror/view"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MarkdownEditor, preloadMarkdownEditor } from "./index"
import { resetMarkdownEditorForTests } from "./markdown-editor"

// React only batches updates inside act().
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

function open(node: React.ReactNode) {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  return host
}

// Renders and flushes effects, including the editor chunk's import.
async function mount(node: React.ReactNode) {
  open(node)
  await act(async () => {
    root?.render(node)
  })
  return host
}

// Renders without waiting for the editor chunk, so the first paint can be inspected.
function mountSync(node: React.ReactNode) {
  open(node)
  act(() => {
    root?.render(node)
  })
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
})

const settle = async () => {
  await act(async () => {
    await preloadMarkdownEditor()
  })
}

const content = () => document.querySelector<HTMLElement>(".cm-content")
const textarea = () => document.querySelector<HTMLTextAreaElement>("textarea.cm-plain")
const view = () => {
  const el = content()
  if (!el) throw new Error("editor is not mounted")
  const found = EditorView.findFromDOM(el.closest(".cm-editor") as HTMLElement)
  if (!found) throw new Error("no EditorView")
  return found
}

function typeInto(el: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  setter?.call(el, text)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

function Controlled({ initial = "", ...rest }: { initial?: string } & Record<string, unknown>) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <MarkdownEditor label="Description" value={value} onChange={setValue} {...rest} />
      <output data-testid="out">{value}</output>
      <button type="button" onClick={() => setValue("replaced from outside")}>
        reset
      </button>
    </>
  )
}
const out = () => document.querySelector("output")?.textContent

describe("MarkdownEditor before the editor chunk has loaded", () => {
  beforeEach(resetMarkdownEditorForTests)

  it("renders an interactive textarea on the first paint", async () => {
    mountSync(<Controlled initial="hello" placeholder="Add a description." />)
    const area = textarea()
    expect(area).not.toBeNull()
    expect(area?.value).toBe("hello")
    expect(area?.getAttribute("aria-label")).toBe("Description")
    expect(area?.placeholder).toBe("Add a description.")
    expect(host?.querySelector("[data-editor]")?.getAttribute("data-editor")).toBe("loading")
    expect(content()).toBeNull()
  })

  it("accepts typing while the editor is still loading", async () => {
    mountSync(<Controlled />)
    const area = textarea()
    expect(area).not.toBeNull()
    await act(async () => typeInto(area as HTMLTextAreaElement, "typed early"))
    expect(out()).toBe("typed early")
  })

  it("keeps text, focus and caret when the editor replaces the textarea", async () => {
    mountSync(<Controlled initial="hello world" />)
    const area = textarea() as HTMLTextAreaElement
    area.focus()
    area.setSelectionRange(2, 5)
    expect(document.activeElement).toBe(area)

    await settle()

    expect(textarea()).toBeNull()
    expect(content()).not.toBeNull()
    expect(view().state.doc.toString()).toBe("hello world")
    expect(document.activeElement).toBe(content())
    const { from, to } = view().state.selection.main
    expect([from, to]).toEqual([2, 5])
  })

  it("does not steal focus on the swap when the textarea was not focused", async () => {
    mountSync(<Controlled initial="calm" />)
    await settle()
    expect(content()).not.toBeNull()
    expect(document.activeElement).not.toBe(content())
  })
})

describe("MarkdownEditor once loaded", () => {
  beforeEach(settle)

  it("renders the editor immediately, with no textarea flash", async () => {
    await mount(<Controlled initial="# Title" />)
    expect(textarea()).toBeNull()
    expect(content()).not.toBeNull()
    expect(host?.querySelector("[data-editor]")?.getAttribute("data-editor")).toBe("ready")
  })

  it("names the textbox and marks it multiline", async () => {
    await mount(<Controlled />)
    expect(content()?.getAttribute("aria-label")).toBe("Description")
    expect(content()?.getAttribute("aria-multiline")).toBe("true")
  })

  it("shows the placeholder while empty", async () => {
    await mount(<Controlled placeholder="Add a description." />)
    expect(document.querySelector(".cm-placeholder")?.textContent).toBe("Add a description.")
  })

  it("emits onChange with the full text on edits", async () => {
    const onChange = mock((_: string) => {})
    await mount(<MarkdownEditor label="d" value="" onChange={onChange} />)
    await act(async () => view().dispatch({ changes: { from: 0, insert: "abc" } }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("abc")
  })

  it("adopts an external value change without echoing it back", async () => {
    const onChange = mock((_: string) => {})
    function Harness() {
      const [v, setV] = useState("one")
      return (
        <>
          <MarkdownEditor
            label="d"
            value={v}
            onChange={(next) => {
              onChange(next)
              setV(next)
            }}
          />
          <button type="button" onClick={() => setV("two")}>
            go
          </button>
        </>
      )
    }
    await mount(<Harness />)
    await act(async () => document.querySelector("button")?.click())
    expect(view().state.doc.toString()).toBe("two")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps the caret out of the way when the parent echoes the typed value", async () => {
    await mount(<Controlled initial="abc" />)
    await act(async () =>
      view().dispatch({ changes: { from: 0, insert: "X" }, selection: { anchor: 3 } }),
    )
    expect(view().state.doc.toString()).toBe("Xabc")
    expect(out()).toBe("Xabc")
    expect(view().state.selection.main.head).toBe(3)
  })

  it("rejects edits beyond maxLength", async () => {
    await mount(<Controlled initial="1234" maxLength={5} />)
    await act(async () => view().dispatch({ changes: { from: 4, insert: "56" } }))
    expect(view().state.doc.toString()).toBe("1234")
    await act(async () => view().dispatch({ changes: { from: 4, insert: "5" } }))
    expect(view().state.doc.toString()).toBe("12345")
    expect(out()).toBe("12345")
  })

  it("leaves Mod-Enter to the surrounding form instead of inserting a line", async () => {
    await mount(<Controlled initial="text" />)
    const el = content() as HTMLElement
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => void el.dispatchEvent(event))
    expect(view().state.doc.toString()).toBe("text")
    expect(event.defaultPrevented).toBe(false)
  })

  it("supports undo of typed text through history", async () => {
    const { undo } = await import("@codemirror/commands")
    await mount(<Controlled initial="base" />)
    await act(async () =>
      view().dispatch({ changes: { from: 4, insert: " more" }, userEvent: "input.type" }),
    )
    expect(out()).toBe("base more")
    await act(async () => void undo(view()))
    expect(out()).toBe("base")
  })

  it("redoes with Mod-Shift-z as well as Mod-y", async () => {
    const { undo } = await import("@codemirror/commands")
    await mount(<Controlled initial="base" />)
    await act(async () =>
      view().dispatch({ changes: { from: 4, insert: "!" }, userEvent: "input.type" }),
    )
    await act(async () => void undo(view()))
    expect(out()).toBe("base")
    const mac = /Mac|iPhone|iPad/.test(navigator.platform)
    await act(async () => {
      content()?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          shiftKey: true,
          ctrlKey: !mac,
          metaKey: mac,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(out()).toBe("base!")
  })

  it("marks the field so a dialog leaves Escape to it", async () => {
    await mount(<Controlled keepsEscape />)
    expect(content()?.hasAttribute("data-keeps-escape")).toBe(true)
    await act(async () => root?.unmount())
    await mount(<Controlled />)
    expect(content()?.hasAttribute("data-keeps-escape")).toBe(false)
  })

  it("forwards focus and blur from the editor", async () => {
    const onFocus = mock(() => {})
    const onBlur = mock(() => {})
    await mount(
      <MarkdownEditor label="d" value="" onChange={() => {}} onFocus={onFocus} onBlur={onBlur} />,
    )
    await act(async () => content()?.focus())
    expect(onFocus).toHaveBeenCalledTimes(1)
    await act(async () => content()?.blur())
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it("focuses at the end of the text with autoFocus", async () => {
    await mount(<Controlled initial="abc" autoFocus />)
    expect(document.activeElement).toBe(content())
    expect(view().state.selection.main.head).toBe(3)
  })

  it("renders live-preview decoration for markdown", async () => {
    await mount(<Controlled initial={"# Heading\n\ntext"} />)
    await act(async () => view().dispatch({ selection: { anchor: view().state.doc.length } }))
    expect(document.querySelector(".cm-lp-h1")?.textContent).toBe("Heading")
  })

  it("destroys the view on unmount", async () => {
    await mount(<Controlled />)
    const mountedHost = host as HTMLElement
    expect(mountedHost.querySelector(".cm-editor")).not.toBeNull()
    await act(async () => root?.unmount())
    expect(mountedHost.querySelector(".cm-editor")).toBeNull()
    root = createRoot(document.createElement("div"))
  })
})
