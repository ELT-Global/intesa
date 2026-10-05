import * as P from "@radix-ui/react-popover"
import { Check } from "lucide-react"
import { type ReactNode, useEffect, useId, useState } from "react"
import { cn } from "@/lib/utils"

export type PickerOption = {
  id: string
  /** Accessible name of the option. */
  label: string
  content: ReactNode
  selected?: boolean
  onSelect: () => void
}

/**
 * Filterable multi-select popover. Focus stays in the filter input; arrow keys move the
 * active option (aria-activedescendant) and Enter toggles it.
 */
export function PickerPopover({
  trigger,
  label,
  placeholder,
  options,
  leading,
  filter,
  onFilterChange,
  empty,
  onOpenChange,
}: {
  trigger: ReactNode
  label: string
  placeholder: string
  options: PickerOption[]
  /** Optional content between the filter input and the list. */
  leading?: ReactNode
  filter: string
  onFilterChange: (value: string) => void
  empty: string
  onOpenChange?: (open: boolean) => void
}) {
  const baseId = useId()
  const [active, setActive] = useState(0)
  const current = Math.min(active, Math.max(options.length - 1, 0))
  const activeDomId = options[current] ? `${baseId}-${options[current].id}` : undefined

  useEffect(() => {
    if (activeDomId) document.getElementById(activeDomId)?.scrollIntoView({ block: "nearest" })
  }, [activeDomId])

  return (
    <P.Root onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          className="z-50 w-64 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
        >
          <input
            role="combobox"
            aria-label={`Filter ${label.toLowerCase()}`}
            aria-expanded={options.length > 0}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls={`${baseId}-list`}
            aria-activedescendant={activeDomId}
            value={filter}
            placeholder={placeholder}
            onChange={(e) => {
              onFilterChange(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && options.length) {
                e.preventDefault()
                setActive((current + 1) % options.length)
              } else if (e.key === "ArrowUp" && options.length) {
                e.preventDefault()
                setActive((current - 1 + options.length) % options.length)
              } else if ((e.key === "Home" || e.key === "End") && !filter && options.length) {
                // With text in the field these keys keep moving the caret.
                e.preventDefault()
                setActive(e.key === "Home" ? 0 : options.length - 1)
              } else if (e.key === "Enter") {
                if (e.nativeEvent.isComposing) return
                e.preventDefault()
                options[current]?.onSelect()
              }
            }}
            className="mb-1 h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24"
          />
          {leading}
          <div
            id={`${baseId}-list`}
            role="listbox"
            aria-multiselectable
            aria-label={`Available ${label.toLowerCase()}`}
            className="max-h-60 overflow-y-auto"
          >
            {options.map((o, i) => (
              // Keyboard use goes through the combobox input, so options are pointer targets only.
              // biome-ignore lint/a11y/useKeyWithClickEvents: see above
              <div
                key={o.id}
                id={`${baseId}-${o.id}`}
                role="option"
                aria-label={o.label}
                aria-selected={o.selected ?? false}
                tabIndex={-1}
                onClick={o.onSelect}
                onMouseMove={() => setActive(i)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground",
                  i === current && "bg-accent",
                  o.selected && "font-medium",
                )}
              >
                {o.content}
                {o.selected && <Check aria-hidden className="ml-auto size-3.5 shrink-0" />}
              </div>
            ))}
          </div>
          {/* Always mounted so the empty message is announced when it appears. */}
          <p
            role="status"
            className={cn(
              "text-[13px] text-muted-foreground",
              options.length === 0 && "px-2 py-1.5",
            )}
          >
            {options.length === 0 ? empty : ""}
          </p>
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
