import { MarkdownEditor } from "@intesa/markdown-editor"
import { useEffect, useRef, useState } from "react"
import { TASK_BODY_MAX_LENGTH } from "@/lib/tasks"
import { cn } from "@/lib/utils"

/** Single-line text field that saves on blur or Enter. Escape reverts. */
export function EditableText({
  label,
  value,
  onCommit,
  required,
  placeholder,
  className,
}: {
  label: string
  value: string
  onCommit: (value: string, revert: () => void) => void
  required?: boolean
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Adopt server changes unless the user is mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])

  // Grow the field with its content.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft drives the height
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  function commit() {
    focused.current = false
    const next = draft.trim()
    if ((required && !next) || next === value) {
      setDraft(value)
      return
    }
    setDraft(next)
    onCommit(next, () => setDraft(value))
  }

  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={1}
      value={draft}
      placeholder={placeholder}
      maxLength={200}
      onFocus={() => {
        focused.current = true
      }}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === "Escape" && draft !== value) {
          e.stopPropagation()
          setDraft(value)
        }
      }}
      className={cn(
        "-mx-2 w-[calc(100%+1rem)] resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 outline-none transition-colors",
        "placeholder:text-muted-foreground hover:bg-muted/40 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/24 dark:focus-visible:ring-ring/48",
        "overflow-hidden",
        className,
      )}
    />
  )
}

/**
 * Markdown description that saves on blur. Escape reverts an unsaved edit. Pasted or dropped
 * images go through `upload` and are inserted as Markdown images; `discard` removes an upload
 * that never reached a saved description, when the owner can delete one.
 */
export function DescriptionField({
  label = "Description",
  value,
  onCommit,
  upload,
  discard,
}: {
  label?: string
  value: string
  onCommit: (value: string, revert: () => void) => void
  upload: (file: File) => Promise<{ id: string; url: string }>
  discard?: (id: string) => void
}) {
  const [draft, setDraftState] = useState(value)
  // Read by commits that run after an upload settles, outside a render.
  const latest = useRef(draft)
  const setDraft = (next: string) => {
    latest.current = next
    setDraftState(next)
  }
  const focused = useRef(false)
  const uploading = useRef(0)
  // Images uploaded since the last save, by URL. The server deletes images that a saved
  // description stops showing; these never reached a saved description, so this deletes them.
  const unsaved = useRef(new Map<string, string>())

  // Adopt server changes unless the user is mid-edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setDraft only writes state
  useEffect(() => {
    if (!focused.current && !uploading.current) setDraft(value)
  }, [value])

  function commit() {
    focused.current = false
    // Saved once the uploads settle, so no "Uploading…" placeholder is saved.
    if (uploading.current) return
    const next = latest.current.trim()
    for (const [url, id] of unsaved.current) {
      if (!next.includes(url)) discard?.(id)
    }
    unsaved.current.clear()
    if (next === value) {
      setDraft(value)
      return
    }
    setDraft(next)
    onCommit(next, () => setDraft(value))
  }

  async function uploadImage(file: File) {
    uploading.current++
    try {
      const { id, url } = await upload(file)
      unsaved.current.set(url, id)
      return url
    } finally {
      uploading.current--
      // The editor swaps the placeholder for the image right after this resolves.
      if (!uploading.current && !focused.current) setTimeout(commit)
    }
  }

  return (
    <MarkdownEditor
      label={label}
      placeholder="Add a description."
      maxLength={TASK_BODY_MAX_LENGTH}
      value={draft}
      onChange={setDraft}
      keepsEscape={draft !== value}
      uploadImage={uploadImage}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape" && draft !== value) {
          e.stopPropagation()
          setDraft(value)
        }
      }}
      className="-mx-2 min-h-32 w-[calc(100%+1rem)] rounded-lg border border-transparent px-2 py-1 transition-colors hover:bg-muted/40 focus-within:border-ring focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/24 dark:focus-within:ring-ring/48"
    />
  )
}
