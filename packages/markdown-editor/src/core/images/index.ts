import type { Extension } from "@codemirror/state"
import { EditorView, WidgetType } from "@codemirror/view"

/** Uploads one image and resolves to the URL the Markdown should point at. */
export type UploadImage = (file: File) => Promise<string>

const IMAGE = /^!\[((?:\\.|[^\]\\])*)\]\(\s*<?([^\s>)]+)>?(?:\s+"[^"]*")?\s*\)$/

/** The alt text and URL of an `![alt](url)` image, when its URL is one we will load. */
export function parseImage(markdown: string) {
  const match = IMAGE.exec(markdown)
  if (!match) return null
  const [, alt = "", src = ""] = match
  // Same-origin paths, web URLs and this page's own blob: previews of images not yet uploaded;
  // anything else (javascript:, file:) stays text.
  if (!/^(\/(?!\/)|https?:\/\/|blob:)/i.test(src)) return null
  return { alt: alt.replace(/\\(.)/g, "$1"), src }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super()
  }

  toDOM(): HTMLElement {
    const img = document.createElement("img")
    img.className = "cm-lp-image"
    img.src = this.src
    img.alt = this.alt
    img.title = this.alt
    img.loading = "lazy"
    // A broken image keeps its alt text visible instead of a zero-size box.
    img.addEventListener("error", () => img.classList.add("cm-lp-image-broken"))
    return img
  }

  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt
  }

  // Clicking the image moves the caret onto it, which reveals the Markdown.
  ignoreEvent(): boolean {
    return false
  }
}

const escapeAlt = (text: string) => text.replace(/[\\[\]]/g, "\\$&")

let uploads = 0

/** Inserts an upload placeholder at `pos` for each file, then swaps in the uploaded image. */
export function insertImages(view: EditorView, files: File[], pos: number, upload: UploadImage) {
  let at = pos
  for (const file of files) {
    // Unique, so the right placeholder is found however the document changed meanwhile.
    const placeholder = `![Uploading ${escapeAlt(file.name)}… #${++uploads}]()`
    const line = view.state.doc.lineAt(at)
    // Images sit on their own line, like GitHub's.
    const before = at > line.from ? "\n" : ""
    const insert = `${before}${placeholder}\n`
    view.dispatch({
      changes: { from: at, insert },
      selection: { anchor: at + insert.length },
      userEvent: "input.paste",
    })
    at += insert.length
    const settle = (text: string) => {
      if (!view.dom.isConnected) return
      const doc = view.state.doc.toString()
      const from = doc.indexOf(placeholder)
      if (from < 0) return
      // A failed upload takes its line break with it.
      const to =
        !text && doc[from + placeholder.length] === "\n"
          ? from + placeholder.length + 1
          : from + placeholder.length
      view.dispatch({ changes: { from, to, insert: text }, userEvent: "input.paste" })
    }
    upload(file).then(
      (url) => settle(`![${escapeAlt(file.name)}](${url})`),
      () => settle(""),
    )
  }
}

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * Clipboard images arrive as "image.png" (or nameless); they are named after the moment they
 * were pasted. Files copied from a file manager keep their own names.
 */
export function screenshotName(file: File, at: Date, index = 0) {
  if (file.name && !/^image\.\w+$/i.test(file.name) && /\.\w+$/.test(file.name)) return file.name
  const subtype = file.type.split("/")[1]?.split(/[;+]/)[0] ?? "png"
  const extension = subtype === "jpeg" ? "jpg" : subtype
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`
  return `Screenshot ${day} at ${time}${index ? ` (${index + 1})` : ""}.${extension}`
}

function imageFiles(list: FileList | null | undefined) {
  const at = new Date()
  return Array.from(list ?? [])
    .filter((file) => file.type.startsWith("image/"))
    .map((file, i) => {
      const name = screenshotName(file, at, i)
      return name === file.name ? file : new File([file], name, { type: file.type })
    })
}

/** Pasting or dropping image files uploads them and inserts them as Markdown images. */
export function imageUploads(upload: UploadImage): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = imageFiles(event.clipboardData?.files)
      if (!files.length) return false
      event.preventDefault()
      insertImages(view, files, view.state.selection.main.head, upload)
      return true
    },
    drop(event, view) {
      const files = imageFiles(event.dataTransfer?.files)
      if (!files.length) return false
      event.preventDefault()
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      insertImages(view, files, pos ?? view.state.selection.main.head, upload)
      return true
    },
  })
}
