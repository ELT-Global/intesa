import { useEffect, useLayoutEffect, useRef } from "react"
import type { MarkdownEditorProps } from "./types"

/**
 * A textarea styled like the editor. It is interactive on the first paint, before the
 * CodeMirror chunk has arrived; `MarkdownEditor` reads its focus and caret when swapping.
 */
export function PlainEditor({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  autoFocus,
  keepsEscape,
}: MarkdownEditorProps) {
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
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
