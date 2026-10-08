import { type ComponentType, useEffect, useRef, useState } from "react"
import { PlainEditor } from "./plain-editor"
import type { EditorViewProps, MarkdownEditorProps, Restore } from "./types"

type ViewComponent = ComponentType<EditorViewProps>

type Loader = () => Promise<{ default: ViewComponent }>

const importEditorView: Loader = () => import("./editor-view")

let loadChunk: Loader = importEditorView
let loaded: ViewComponent | null = null
let loading: Promise<ViewComponent> | null = null

/** Starts fetching the editor chunk. Safe to call repeatedly; call it when idle. */
export function preloadMarkdownEditor(): Promise<ViewComponent> {
  loading ??= loadChunk().then(
    (m) => {
      loaded = m.default
      return m.default
    },
    (error) => {
      // A failed fetch (offline, deploy in flight) must not be cached: the next call retries.
      loading = null
      throw error
    },
  )
  return loading
}

/**
 * Test seam: forget the cached chunk so the next mount starts from the textarea again,
 * optionally swapping the loader to simulate a slow or failing fetch.
 */
export function resetMarkdownEditorForTests(loader: Loader = importEditorView) {
  loadChunk = loader
  loaded = null
  loading = null
}

interface Ready {
  View: ViewComponent
  restore: Restore | null
}

/**
 * Live-preview markdown editor. The first paint is a plain textarea so typing never waits on
 * the CodeMirror chunk; once it arrives the editor replaces it in place, keeping focus,
 * caret and text. When the chunk is already cached the editor renders immediately.
 * If the chunk cannot be fetched the textarea simply stays.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const { className, onFocus, onBlur, onKeyDown } = props
  const [ready, setReady] = useState<Ready | null>(() =>
    loaded ? { View: loaded, restore: null } : null,
  )
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ready) return
    let alive = true
    preloadMarkdownEditor().then(
      (View) => {
        if (!alive) return
        const active = document.activeElement
        const focused = active instanceof HTMLTextAreaElement && wrapper.current?.contains(active)
        setReady({
          View,
          restore: focused ? { from: active.selectionStart, to: active.selectionEnd } : null,
        })
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [ready])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: events bubble from the field inside; nothing here is interactive
    <div
      ref={wrapper}
      className={className ? `cm-doc-editor ${className}` : "cm-doc-editor"}
      data-editor={ready ? "ready" : "loading"}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      {ready ? <ready.View {...props} restore={ready.restore} /> : <PlainEditor {...props} />}
    </div>
  )
}
