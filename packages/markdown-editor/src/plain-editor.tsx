import { type RefObject, useEffect, useLayoutEffect, useRef } from "react"
import type { Handoff, MarkdownEditorProps } from "./types"

/**
 * A textarea styled like the editor. It is interactive on the first paint, before the
 * CodeMirror chunk has arrived, and reports its focus and caret so the swap is invisible.
 */
export function PlainEditor({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  autoFocus,
  keepsEscape,
  handoff,
}: MarkdownEditorProps & { handoff: RefObject<Handoff> }) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the value drives the height
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const remember = () => {
    const el = ref.current
    if (!el) return
    handoff.current = {
      focused: document.activeElement === el,
      from: el.selectionStart,
      to: el.selectionEnd,
    }
  }

  return (
    <textarea
      ref={ref}
      className="cm-plain"
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={1}
      value={value}
      data-keeps-escape={keepsEscape ? "" : undefined}
      onChange={(e) => {
        onChange(e.target.value)
        remember()
      }}
      onSelect={remember}
      onFocus={remember}
    />
  )
}
