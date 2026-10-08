import { Search, X } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { applySuggestion, suggest } from "@/lib/task-search"
import type { TaskSummary } from "@/lib/tasks"
import { cn } from "@/lib/utils"

/**
 * A search icon that opens a query field with suggestions (see lib/task-search). The field stays
 * open while it holds a query, so a filtered list never looks unfiltered.
 */
export function TaskSearch({
  query,
  onChange,
  tasks,
}: {
  query: string
  onChange: (query: string) => void
  /** Where people and tag suggestions come from. */
  tasks: readonly TaskSummary[]
}) {
  const [open, setOpen] = useState(query !== "")
  const [caret, setCaret] = useState(query.length)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const listId = useId()

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  // Put the caret after an accepted suggestion once React has written the new value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every query change
  useEffect(() => {
    const at = pendingCaret.current
    if (at === null || !input.current) return
    pendingCaret.current = null
    input.current.setSelectionRange(at, at)
  }, [query])

  const found = suggest(query, caret, tasks)
  const shown = focused && !dismissed ? found.suggestions : []
  const current = Math.min(active, shown.length - 1)
  const optionId = (i: number) => `${listId}-${i}`

  function accept(i: number) {
    const s = shown[i]
    if (!s) return
    const next = applySuggestion(query, found, s)
    pendingCaret.current = next.caret
    setCaret(next.caret)
    setActive(-1)
    setDismissed(false)
    onChange(next.query)
  }

  function close() {
    onChange("")
    setOpen(false)
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        icon
        aria-label="Search tasks"
        onClick={() => setOpen(true)}
      >
        <Search />
      </Button>
    )
  }

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-80">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={input}
        role="combobox"
        aria-label="Search tasks"
        aria-expanded={shown.length > 0}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={current >= 0 ? optionId(current) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder="Search, or try priority:medium"
        onChange={(e) => {
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setActive(-1)
          setDismissed(false)
          onChange(e.target.value)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === "ArrowDown" && shown.length) {
            e.preventDefault()
            setActive((current + 1) % shown.length)
          } else if (e.key === "ArrowUp" && shown.length) {
            e.preventDefault()
            setActive((current - 1 + shown.length) % shown.length)
          } else if (e.key === "Enter" && current >= 0) {
            e.preventDefault()
            accept(current)
          } else if (e.key === "Tab" && shown.length && !e.shiftKey) {
            e.preventDefault()
            accept(Math.max(current, 0))
          } else if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            if (shown.length) setDismissed(true)
            else close()
          }
        }}
        className="h-7 w-full rounded-lg border border-input bg-background pr-8 pl-8 text-[13px] shadow-xs/5 outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 pointer-coarse:h-9 dark:focus-visible:ring-ring/48"
      />
      <Button
        variant="ghost"
        size="xs"
        icon
        aria-label={query ? "Clear search" : "Close search"}
        onClick={close}
        className="absolute top-1/2 right-0.5 -translate-y-1/2"
      >
        <X />
      </Button>
      <div
        id={listId}
        role="listbox"
        aria-label="Search suggestions"
        hidden={shown.length === 0}
        className="absolute top-full left-0 z-50 mt-1 w-full min-w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        {shown.map((s, i) => (
          // Keyboard use goes through the input, so options are pointer targets only. Mouse down
          // is prevented so the input keeps focus and the list does not close before the click.
          // biome-ignore lint/a11y/useKeyWithClickEvents: see above
          <div
            key={s.insert}
            id={optionId(i)}
            role="option"
            tabIndex={-1}
            aria-selected={i === current}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => accept(i)}
            onMouseMove={() => setActive(i)}
            className={cn(
              "flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-[13px]",
              i === current && "bg-accent",
            )}
          >
            <span className={cn("font-medium", s.partial && "font-mono")}>{s.label}</span>
            {s.hint && <span className="truncate text-xs text-muted-foreground">{s.hint}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
