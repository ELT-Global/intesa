import { markdownLanguage } from "@codemirror/lang-markdown"
import { EditorSelection, type EditorState } from "@codemirror/state"
import { Decoration, EditorView } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"

import { inCode } from "../shared/code"

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

/**
 * The URL a link may open, or null. Only web URLs, mail addresses and same-origin paths are
 * followed; anything else (javascript:, data:, file:, protocol-relative //host) stays text.
 */
export function safeHref(url: string): string | null {
  const href = url.trim()
  if (/^https?:\/\/[^\s/]/i.test(href)) return href
  if (/^mailto:[^\s]/i.test(href)) return href
  // A path on this origin: "/x" but not "//host" or "/\host", which browsers treat as a host.
  if (/^\/(?![/\\])/.test(href) || /^[#?]/.test(href)) return href
  return null
}

/** Where a GFM autolink literal (`https://…`, `www.…`, `name@host`) points, if it is safe. */
export function literalHref(text: string): string | null {
  if (/^www\./i.test(text)) return safeHref(`http://${text}`)
  if (!/^[a-z][\w+.-]*:/i.test(text) && text.includes("@")) return safeHref(`mailto:${text}`)
  return safeHref(text)
}

/** The destination of a `Link`, `Autolink` or literal `URL` node, if it is one we follow. */
export function nodeHref(state: EditorState, node: SyntaxNode): string | null {
  if (node.name === "URL") return literalHref(state.sliceDoc(node.from, node.to))
  const url = node.getChild("URL")
  if (!url) return null
  const text = state.sliceDoc(url.from, url.to)
  return node.name === "Autolink" ? literalHref(text) : safeHref(text)
}

// ---------------------------------------------------------------------------
// Rendered links
// ---------------------------------------------------------------------------

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform)

/** Ctrl on Windows and Linux, Cmd on macOS: the key that edits a link instead of opening it. */
const modKey = (event: MouseEvent) => (isMac() ? event.metaKey : event.ctrlKey)

/** Hover text: where the link goes and, when it can be edited, how to edit it. */
export function linkTitle(href: string, editable: boolean): string {
  return editable ? `${href}\n${isMac() ? "⌘" : "Ctrl"}+click to edit` : href
}

/** Attributes that make a rendered link an anchor opening in a new tab. */
export function linkAttributes(href: string, editable: boolean): Record<string, string> {
  return {
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    title: linkTitle(href, editable),
  }
}

/** The mark for a rendered link: a real anchor, so it reads as a link to assistive tech too. */
export function linkMark(href: string, editable: boolean) {
  return Decoration.mark({
    tagName: "a",
    class: "cm-lp-link",
    attributes: linkAttributes(href, editable),
  })
}

/** The rendered link an event happened on. */
export function linkTarget(event: Event): HTMLAnchorElement | null {
  const target = event.target
  const el =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  return el?.closest<HTMLAnchorElement>("a.cm-lp-link[href]") ?? null
}

/** Opens a rendered link in a new tab, without giving that page a handle on this one. */
export function openLink(link: HTMLAnchorElement) {
  const href = safeHref(link.getAttribute("href") ?? "")
  if (href) window.open(href, "_blank", "noopener,noreferrer")
}

type Gesture = "open" | "edit" | "other"

/** A plain click opens a link; Mod+click edits it; anything else is left to the browser. */
export function linkGesture(event: MouseEvent): Gesture {
  if (event.button !== 0 || event.shiftKey || event.altKey) return "other"
  const mod = modKey(event)
  const other = isMac() ? event.ctrlKey : event.metaKey
  if (other) return "other"
  return mod ? "edit" : "open"
}

/**
 * Click handling for links rendered by the live preview. A plain click opens the link without
 * moving the caret, so the Markdown stays hidden; Mod+click puts the caret in the link to edit
 * it. Arrow keys still walk into a link and reveal its Markdown as before.
 */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const link = linkTarget(event)
    if (!link) return false
    const gesture = linkGesture(event)
    if (gesture === "open") {
      // No caret, no focus change: the link keeps rendering while it opens.
      event.preventDefault()
      return true
    }
    if (gesture === "edit" && !view.state.readOnly) {
      // CodeMirror would add a second cursor on Mod+click; editing wants just this one.
      event.preventDefault()
      // Where the pointer is, kept inside the link in case it sits on the link's very edge.
      const from = view.posAtDOM(link, 0)
      const to = view.posAtDOM(link, link.childNodes.length)
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? from
      const pos = Math.min(Math.max(at, from), to)
      view.focus()
      view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true })
      return true
    }
    return false
  },
  click(event, view) {
    const link = linkTarget(event)
    if (!link) return false
    const gesture = linkGesture(event)
    if (gesture === "open") {
      event.preventDefault()
      openLink(link)
      return true
    }
    // An editable document must not follow its links natively on Mod+click.
    if (gesture === "edit" && !view.state.readOnly) {
      event.preventDefault()
      return true
    }
    return false
  },
})

// ---------------------------------------------------------------------------
// Pasting URLs
// ---------------------------------------------------------------------------

/** The clipboard text when it is exactly one http(s) URL, else null. */
export function pastedUrl(text: string): string | null {
  const url = text.trim()
  if (!/^https?:\/\/[^\s<>]+$/i.test(url)) return null
  try {
    new URL(url)
  } catch {
    return null
  }
  return url
}

/** True when `url` on its own parses as one GFM autolink literal covering all of it. */
function wholeLiteral(url: string): boolean {
  const tree = markdownLanguage.parser.parse(url)
  let whole = false
  tree.iterate({
    enter(node) {
      if (node.name === "URL" && node.from === 0 && node.to === url.length) whole = true
      return !whole
    },
  })
  return whole
}

const balancedParens = (url: string) => {
  let depth = 0
  for (const c of url) {
    if (c === "(") depth++
    else if (c === ")" && --depth < 0) return false
  }
  return depth === 0
}

/**
 * The Markdown for a pasted URL. Over a selection it links the selection (`[text](url)`);
 * otherwise the bare URL, which renders as a link, or `<url>` where a bare one would not be
 * recognised (straight after a word, or ending in punctuation the literal would drop).
 */
export function urlPaste(url: string, selected: string, before: string): string {
  if (selected) {
    const label = selected.replace(/(?<!\\)[[\]]/g, "\\$&")
    return `[${label}](${balancedParens(url) ? url : `<${url}>`})`
  }
  const boundary = before === "" || /[\s*_~(]/.test(before)
  return boundary && wholeLiteral(url) ? url : `<${url}>`
}

/**
 * Pasting a single http(s) URL links it, the way GitHub does. Other text, multi-line text,
 * files (images are uploaded instead) and pastes into code are left to the default paste.
 */
export const linkPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData
    if (!data || data.files.length > 0) return false
    const url = pastedUrl(data.getData("text/plain"))
    if (!url || view.state.readOnly) return false
    const { state } = view
    const ranges = state.selection.ranges
    // A selection that is itself a URL, spans lines or sits in code is simply replaced.
    const plain = ranges.some((r) => {
      const selected = state.sliceDoc(r.from, r.to)
      return inCode(state, r.from) || selected.includes("\n") || pastedUrl(selected) !== null
    })
    if (plain) return false
    event.preventDefault()
    view.dispatch(
      state.changeByRange((range) => {
        const insert = urlPaste(
          url,
          state.sliceDoc(range.from, range.to),
          state.sliceDoc(Math.max(0, range.from - 1), range.from),
        )
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        }
      }),
      { scrollIntoView: true, userEvent: "input.paste" },
    )
    return true
  },
})
