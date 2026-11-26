import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { EditorSelection, EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import {
  createMarkdownEditorExtensions,
  imageUploads,
  literalHref,
  pastedUrl,
  safeHref,
  urlPaste,
} from "../index"

function view(doc: string, extra: Extension = []) {
  const parent = document.createElement("div")
  document.body.appendChild(parent)
  const v = new EditorView({
    state: EditorState.create({ doc, extensions: [createMarkdownEditorExtensions(), extra] }),
    parent,
  })
  return { parent, view: v }
}

const readOnly = [EditorState.readOnly.of(true), EditorView.editable.of(false)]

function paste(v: EditorView, text: string, files: File[] = []) {
  const data = new DataTransfer()
  data.setData("text/plain", text)
  for (const file of files) data.items.add(file)
  const event = new ClipboardEvent("paste", {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  })
  v.contentDOM.dispatchEvent(event)
  return event
}

function select(v: EditorView, text: string) {
  const from = v.state.doc.toString().indexOf(text)
  if (from < 0) throw new Error(`no "${text}"`)
  v.dispatch({ selection: EditorSelection.range(from, from + text.length) })
}

const atEnd = (v: EditorView) =>
  v.dispatch({ selection: EditorSelection.cursor(v.state.doc.length) })

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const mod = isMac ? { metaKey: true } : { ctrlKey: true }

function click(el: Element, init: MouseEventInit = {}) {
  const opts = { bubbles: true, cancelable: true, button: 0, ...init }
  const down = new MouseEvent("mousedown", opts)
  el.dispatchEvent(down)
  el.dispatchEvent(new MouseEvent("mouseup", opts))
  const up = new MouseEvent("click", opts)
  el.dispatchEvent(up)
  return { down, up }
}

let opened: ReturnType<typeof mock>
const realOpen = window.open

beforeEach(() => {
  opened = mock(() => null)
  window.open = opened as unknown as typeof window.open
})

afterEach(() => {
  window.open = realOpen
  document.body.innerHTML = ""
})

describe("link destinations", () => {
  it("follows web, mail and same-origin links only", () => {
    expect(safeHref("https://example.com/a?b#c")).toBe("https://example.com/a?b#c")
    expect(safeHref("HTTP://example.com")).toBe("HTTP://example.com")
    expect(safeHref("mailto:ada@example.com")).toBe("mailto:ada@example.com")
    expect(safeHref("/w/acme/projects/1")).toBe("/w/acme/projects/1")
    expect(safeHref("#notes")).toBe("#notes")
    expect(safeHref("javascript:alert(1)")).toBeNull()
    expect(safeHref(" JavaScript:alert(1)")).toBeNull()
    expect(safeHref("data:text/html,<script>")).toBeNull()
    expect(safeHref("//evil.example")).toBeNull()
    expect(safeHref("/\\evil.example")).toBeNull()
    expect(safeHref("file:///etc/passwd")).toBeNull()
    expect(safeHref("relative/path")).toBeNull()
  })

  it("resolves GFM literals: www. as http, bare addresses as mailto", () => {
    expect(literalHref("www.example.com")).toBe("http://www.example.com")
    expect(literalHref("ada@example.com")).toBe("mailto:ada@example.com")
    expect(literalHref("https://example.com")).toBe("https://example.com")
  })
})

describe("pasting URLs", () => {
  it("treats only a single http(s) URL as a URL paste", () => {
    expect(pastedUrl("  https://example.com/a  \n")).toBe("https://example.com/a")
    expect(pastedUrl("see https://example.com")).toBeNull()
    expect(pastedUrl("https://a.com\nhttps://b.com")).toBeNull()
    expect(pastedUrl("ftp://example.com")).toBeNull()
    expect(pastedUrl("javascript:alert(1)")).toBeNull()
    expect(pastedUrl("https://")).toBeNull()
  })

  it("chooses Markdown that renders as a link where it lands", () => {
    expect(urlPaste("https://a.com", "docs", " ")).toBe("[docs](https://a.com)")
    expect(urlPaste("https://a.com", "a [b]", "")).toBe(String.raw`[a \[b\]](https://a.com)`)
    expect(urlPaste("https://w.org/Foo_(bar)", "Foo", "")).toBe("[Foo](https://w.org/Foo_(bar))")
    expect(urlPaste("https://a.com/x)", "x", "")).toBe("[x](<https://a.com/x)>)")
    expect(urlPaste("https://a.com/x", "", " ")).toBe("https://a.com/x")
    expect(urlPaste("https://a.com/x", "", "")).toBe("https://a.com/x")
    // Glued to a word, or ending in punctuation, a bare URL would not (all) be a link.
    expect(urlPaste("https://a.com/x", "", "e")).toBe("<https://a.com/x>")
    expect(urlPaste("https://a.com/x.", "", " ")).toBe("<https://a.com/x.>")
  })

  it("links the selection when a URL is pasted over it", () => {
    const { view: v } = view("Read the docs today")
    select(v, "the docs")
    const event = paste(v, "https://example.com/docs")
    expect(event.defaultPrevented).toBe(true)
    expect(v.state.doc.toString()).toBe("Read [the docs](https://example.com/docs) today")
    expect(v.state.selection.main.head).toBe("Read [the docs](https://example.com/docs)".length)
  })

  it("inserts a bare URL that renders as a link", () => {
    const { parent, view: v } = view("See ")
    atEnd(v)
    paste(v, "https://example.com/a")
    expect(v.state.doc.toString()).toBe("See https://example.com/a")
    v.dispatch({ changes: { from: v.state.doc.length, insert: "\nnext" } })
    atEnd(v)
    expect(parent.querySelector("a.cm-lp-link")?.getAttribute("href")).toBe("https://example.com/a")
  })

  it("wraps a URL pasted against a word in angle brackets", () => {
    const { view: v } = view("link:")
    atEnd(v)
    paste(v, "https://example.com")
    expect(v.state.doc.toString()).toBe("link:<https://example.com>")
  })

  it("leaves other pastes to the default handling", () => {
    const { view: v } = view("x")
    atEnd(v)
    paste(v, " see https://example.com")
    paste(v, "\nhttps://a.com\nhttps://b.com")
    expect(v.state.doc.toString()).toBe("x see https://example.com\nhttps://a.com\nhttps://b.com")
  })

  it("pastes a URL into code as it is", () => {
    const { view: v } = view("`code` and\n```\nfenced\n```")
    select(v, "code")
    paste(v, "https://a.example")
    select(v, "fenced")
    paste(v, "https://b.example")
    expect(v.state.doc.toString()).toBe("`https://a.example` and\n```\nhttps://b.example\n```")
  })

  it("replaces a selected URL with the pasted one instead of nesting links", () => {
    const { view: v } = view("https://old.example")
    select(v, "https://old.example")
    paste(v, "https://new.example")
    expect(v.state.doc.toString()).toBe("https://new.example")
  })

  it("leaves pasted images to the image upload", () => {
    const uploads: string[] = []
    const { view: v } = view(
      "",
      imageUploads(async (file) => {
        uploads.push(file.name)
        return "/img/1"
      }),
    )
    const png = new File([new Uint8Array([1])], "shot.png", { type: "image/png" })
    paste(v, "https://example.com/shot.png", [png])
    expect(uploads).toEqual(["shot.png"])
    expect(v.state.doc.toString()).toMatch(/^!\[Uploading shot\.png… #\d+\]\(\)\n$/)
  })
})

describe("rendered links", () => {
  it("renders links away from the caret as anchors opening in a new tab", () => {
    const { parent, view: v } = view(
      "[Docs](https://example.com/docs) www.example.org <https://example.net> ada@example.com\nend",
    )
    atEnd(v)
    const anchors = [...parent.querySelectorAll<HTMLAnchorElement>("a.cm-lp-link")]
    expect(anchors.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Docs", "https://example.com/docs"],
      ["www.example.org", "http://www.example.org"],
      ["https://example.net", "https://example.net"],
      ["ada@example.com", "mailto:ada@example.com"],
    ])
    for (const a of anchors) {
      expect(a.getAttribute("target")).toBe("_blank")
      expect(a.getAttribute("rel")).toBe("noopener noreferrer")
      expect(a.title).toStartWith(a.getAttribute("href") ?? "")
    }
    expect(parent.textContent).not.toContain("<https://example.net>")
  })

  it("never makes an anchor of an unsafe destination", () => {
    const { parent, view: v } = view("[x](javascript:alert(1)) [y](//evil.example)\nend")
    atEnd(v)
    expect(parent.querySelector("a")).toBeNull()
    // It still reads as a link label, just not one that goes anywhere.
    expect(parent.querySelectorAll(".cm-lp-link")).toHaveLength(2)
  })

  it("shows the Markdown, not an anchor, at the caret of a focused editor", () => {
    const { parent, view: v } = view("<https://example.net> https://example.com\nend")
    v.focus()
    v.dispatch({ selection: EditorSelection.cursor(3) })
    expect(parent.textContent).toContain("<https://example.net>")
    const anchors = [...parent.querySelectorAll("a.cm-lp-link")].map((a) => a.textContent)
    expect(anchors).toEqual(["https://example.com"])
  })

  it("opens a link on a plain click without moving the caret or revealing it", () => {
    const { parent, view: v } = view("intro [Docs](https://example.com/docs)\nend")
    v.focus()
    atEnd(v)
    const link = parent.querySelector("a.cm-lp-link") as HTMLAnchorElement
    const { down, up } = click(link)
    expect(down.defaultPrevented).toBe(true)
    expect(up.defaultPrevented).toBe(true)
    expect(opened).toHaveBeenCalledWith("https://example.com/docs", "_blank", "noopener,noreferrer")
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
    expect(parent.textContent).not.toContain("](")
  })

  it("puts the caret in the link on Mod+click, revealing its Markdown to edit", () => {
    const { parent, view: v } = view("intro [Docs](https://example.com/docs)\nend")
    atEnd(v)
    const link = parent.querySelector("a.cm-lp-link") as HTMLAnchorElement
    click(link, mod)
    expect(opened).not.toHaveBeenCalled()
    const head = v.state.selection.main.head
    expect(head).toBeGreaterThanOrEqual("intro ".length)
    expect(head).toBeLessThanOrEqual("intro [Docs](https://example.com/docs)".length)
    expect(v.state.selection.ranges).toHaveLength(1)
    expect(parent.textContent).toContain("[Docs](https://example.com/docs)")
  })

  it("opens links in a read-only document", () => {
    const { parent } = view("https://example.com/a", readOnly)
    const link = parent.querySelector("a.cm-lp-link") as HTMLAnchorElement
    expect(link.title).toBe("https://example.com/a")
    click(link)
    expect(opened).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer")
  })

  it("opens a link in a rendered table without revealing the table", () => {
    const { parent, view: v } = view(
      "| Site | Note |\n| --- | --- |\n| [shop](https://shop.example) | https://b.example |\n\nend",
    )
    v.focus()
    atEnd(v)
    const links = [...parent.querySelectorAll<HTMLAnchorElement>("table a.cm-lp-link")]
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://shop.example",
      "https://b.example",
    ])
    click(links[0] as HTMLAnchorElement)
    expect(opened).toHaveBeenCalledWith("https://shop.example", "_blank", "noopener,noreferrer")
    expect(parent.querySelector("table.cm-lp-table")).not.toBeNull()
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
  })
})
