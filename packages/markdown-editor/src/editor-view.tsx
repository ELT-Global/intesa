import { defaultKeymap, history, historyKeymap, redo } from "@codemirror/commands"
import { Annotation, Compartment, EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view"
import { useEffect, useRef } from "react"
import { createMarkdownEditorExtensions } from "./core"
import type { EditorViewProps } from "./types"

/** Marks the transactions that copy the `value` prop into the document, so they are not echoed. */
const external = Annotation.define<boolean>()

/** Holds the content attributes so `label` and `keepsEscape` can change after creation. */
const attrs = new Compartment()

// Mod-Enter belongs to the surrounding form ("submit"); the default keymap would insert a
// blank line instead.
const baseKeymap = defaultKeymap.filter((b) => b.key !== "Mod-Enter")

const contentAttrs = (label: string, keepsEscape?: boolean) =>
  EditorView.contentAttributes.of({
    "aria-label": label,
    "aria-multiline": "true",
    ...(keepsEscape ? { "data-keeps-escape": "" } : {}),
  })

export default function MarkdownEditorView({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  autoFocus,
  keepsEscape,
  restore,
}: EditorViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // The last text this editor produced or was given; lets the sync effect skip echoes
  // without serialising the document on every render.
  const synced = useRef(value)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is created once; later prop changes are synced below
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const v = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
            ...baseKeymap,
            ...historyKeymap,
          ]),
          ...createMarkdownEditorExtensions(),
          attrs.of(contentAttrs(label, keepsEscape)),
          placeholder ? placeholderExt(placeholder) : [],
          maxLength ? EditorState.changeFilter.of((tr) => tr.newDoc.length <= maxLength) : [],
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((t) => t.annotation(external))) return
            synced.current = u.state.doc.toString()
            onChangeRef.current(synced.current)
          }),
        ],
      }),
    })
    view.current = v

    if (restore) {
      const end = v.state.doc.length
      v.dispatch({
        selection: EditorSelection.range(Math.min(restore.from, end), Math.min(restore.to, end)),
      })
      v.focus()
    } else if (autoFocus) {
      v.dispatch({ selection: EditorSelection.cursor(v.state.doc.length) })
      v.focus()
    }
    return () => {
      v.destroy()
      view.current = null
    }
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: attrs.reconfigure(contentAttrs(label, keepsEscape)) })
  }, [label, keepsEscape])

  useEffect(() => {
    const v = view.current
    if (!v || value === synced.current) return
    synced.current = value
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: value },
      annotations: external.of(true),
    })
  }, [value])

  return <div ref={host} className="cm-host" />
}
