import { afterEach, describe, expect, it } from "bun:test"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { createMarkdownEditorExtensions, insertImages, parseImage, screenshotName } from "../index"

function view(doc: string) {
  const parent = document.createElement("div")
  document.body.appendChild(parent)
  const v = new EditorView({
    state: EditorState.create({ doc, extensions: createMarkdownEditorExtensions() }),
    parent,
  })
  return { parent, view: v }
}

const deferred = () => {
  let resolve!: (url: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const png = (name: string) => new File([new Uint8Array([1])], name, { type: "image/png" })

afterEach(() => {
  document.body.innerHTML = ""
})

describe("images", () => {
  it("parses only same-origin paths and web URLs", () => {
    expect(parseImage(String.raw`![A \[b\]](/api/tasks/1/artifacts/2)`)).toEqual({
      alt: "A [b]",
      src: "/api/tasks/1/artifacts/2",
    })
    expect(parseImage('![x](https://example.com/a.png "Title")')?.src).toBe(
      "https://example.com/a.png",
    )
    expect(parseImage("![x](javascript:alert(1))")).toBeNull()
    expect(parseImage("![x](//evil.example/a.png)")).toBeNull()
    expect(parseImage("![x]()")).toBeNull()
  })

  it("renders an image away from the caret and shows its Markdown on it", () => {
    const { parent, view: v } = view("![Shot](/img/1)\nplain")
    v.dispatch({ selection: EditorSelection.cursor(v.state.doc.length) })
    const img = parent.querySelector<HTMLImageElement>("img.cm-lp-image")
    expect(img?.getAttribute("src")).toBe("/img/1")
    expect(img?.alt).toBe("Shot")
    expect(parent.textContent).not.toContain("![Shot]")
    // The caret only reveals the Markdown while the editor has focus.
    v.dispatch({ selection: EditorSelection.cursor(3) })
    expect(parent.querySelector("img.cm-lp-image")).not.toBeNull()
    v.focus()
    expect(parent.querySelector("img.cm-lp-image")).toBeNull()
    expect(parent.textContent).toContain("![Shot](/img/1)")
  })

  it("leaves unsafe image URLs as text", () => {
    const { parent, view: v } = view("![x](javascript:alert(1))\nplain")
    v.dispatch({ selection: EditorSelection.cursor(v.state.doc.length) })
    expect(parent.querySelector("img")).toBeNull()
  })

  it("inserts a placeholder on its own line, then the uploaded image", async () => {
    const { view: v } = view("Before after")
    const upload = deferred()
    insertImages(v, [png("Shot [1].png")], "Before".length, () => upload.promise)
    expect(v.state.doc.toString()).toMatch(
      /^Before\n!\[Uploading Shot \\\[1\\\]\.png… #\d+\]\(\)\n after$/,
    )
    // Edits made while the upload runs are kept.
    v.dispatch({ changes: { from: 0, insert: "Edited " } })
    upload.resolve("/api/tasks/t/artifacts/a")
    await upload.promise
    expect(v.state.doc.toString()).toBe(
      String.raw`Edited Before
![Shot \[1\].png](/api/tasks/t/artifacts/a)
 after`,
    )
  })

  it("removes the placeholder when an upload fails", async () => {
    const { view: v } = view("")
    const upload = deferred()
    insertImages(v, [png("a.png")], 0, () => upload.promise)
    upload.reject(new Error("too big"))
    await upload.promise.catch(() => {})
    await Promise.resolve()
    expect(v.state.doc.toString()).toBe("")
  })

  it("names clipboard images after the moment they were pasted", () => {
    const at = new Date(2026, 10, 11, 9, 5, 3)
    expect(screenshotName(png("image.png"), at)).toBe("Screenshot 2026-11-11 at 09.05.03.png")
    expect(screenshotName(png("image.png"), at, 1)).toBe(
      "Screenshot 2026-11-11 at 09.05.03 (2).png",
    )
    const jpeg = new File([new Uint8Array([1])], "", { type: "image/jpeg" })
    expect(screenshotName(jpeg, at)).toBe("Screenshot 2026-11-11 at 09.05.03.jpg")
    expect(screenshotName(png("design.png"), at)).toBe("design.png")
  })
})
