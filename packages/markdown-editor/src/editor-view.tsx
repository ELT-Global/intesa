import { defaultKeymap, history, historyKeymap, redo } from "@codemirror/commands"
import { Annotation, Compartment, EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view"
import { type RefObject, useEffect, useRef } from "react"
import { createMarkdownEditorExtensions } from "./core"
import type { Handoff, MarkdownEditorProps } from "./types"

const external = Annotation.define<boolean>()
const attrs = new Compartment()

// Mod-Enter belongs to the surrounding form ("submit"); the default keymap would
// insert a blank line instead.
const baseKeymap = defaultKeymap.filter((b) => b.key !== "Mod-Enter")

export const contentAttrs = (label: string, keepsEscape?: boolean) =>
  EditorView.contentAttributes.of({
    "aria-label": label,
    "aria-multiline": "true",
    ...(keepsEscape ? { "data-keeps-escape": "" } : {}),
  })

export interface EditorStateOptions {
  doc: string
  label: string
  placeholder?: string
  maxLength?: number
  keepsEscape?: boolean
  onChange: (value: string) => void
}

export function createEditorState({
  doc,
  label,
  placeholder,
  maxLength,
  keepsEscape,
  onChange,
}: EditorStateOptions) {
  return EditorState.create({
    doc,
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
        if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) {
          onChange(u.state.doc.toString())
        }
      }),
    ],
  })
}

export default function MarkdownEditorView({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  autoFocus,
  keepsEscape,
  handoff,
}: MarkdownEditorProps & { handoff: RefObject<Handoff> }) {
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
      state: createEditorState({
        doc: value,
        label,
        placeholder,
        maxLength,
        keepsEscape,
        onChange: (next) => {
          synced.current = next
          onChangeRef.current(next)
        },
      }),
    })
    view.current = v
    const { focused, from, to } = handoff.current
    if (focused || autoFocus) {
      const len = v.state.doc.length
      v.dispatch({
        selection: focused
          ? EditorSelection.range(Math.min(from, len), Math.min(to, len))
          : EditorSelection.cursor(len),
      })
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
