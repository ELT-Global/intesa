import { type ComponentType, type RefObject, useEffect, useRef, useState } from "react"
import { PlainEditor } from "./plain-editor"
import type { Handoff, MarkdownEditorProps } from "./types"

type ViewComponent = ComponentType<MarkdownEditorProps & { handoff: RefObject<Handoff> }>

let loaded: ViewComponent | null = null
let loading: Promise<ViewComponent> | null = null

/** Starts fetching the editor chunk. Safe to call repeatedly; call it when idle. */
export function preloadMarkdownEditor(): Promise<ViewComponent> {
  loading ??= import("./editor-view").then((m) => {
    loaded = m.default
    return m.default
  })
  return loading
}

/** Test seam: forget the cached chunk so the next mount starts from the textarea again. */
export function resetMarkdownEditorForTests() {
  loaded = null
  loading = null
}

/**
 * Live-preview markdown editor. The first paint is a plain textarea so typing never waits on
 * the CodeMirror chunk; once it arrives the editor replaces it in place, keeping focus,
 * caret and text. When the chunk is already cached the editor renders immediately.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const { className, onFocus, onBlur, onKeyDown } = props
  const [View, setView] = useState<ViewComponent | null>(() => loaded)
  const handoff = useRef<Handoff>({ focused: false, from: 0, to: 0 })
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (View) return
    let alive = true
    preloadMarkdownEditor().then((component) => {
      if (!alive) return
      const active = document.activeElement
      if (active instanceof HTMLTextAreaElement && wrapper.current?.contains(active)) {
        handoff.current = { focused: true, from: active.selectionStart, to: active.selectionEnd }
      }
      setView(() => component)
    })
    return () => {
      alive = false
    }
  }, [View])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus events bubble from the field inside; nothing here is interactive
    <div
      ref={wrapper}
      className={className ? `cm-doc-editor ${className}` : "cm-doc-editor"}
      data-editor={View ? "ready" : "loading"}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      {View ? <View {...props} handoff={handoff} /> : <PlainEditor {...props} handoff={handoff} />}
    </div>
  )
}
