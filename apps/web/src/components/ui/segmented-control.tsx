import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type Segment<T extends string> = { value: T; label: string; icon?: ReactNode }

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
}: {
  segments: Segment<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own box styles
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5"
    >
      {segments.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={s.value === value}
          onClick={() => onChange(s.value)}
          className={cn(
            "touch-target inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3",
            s.value === value
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          {s.icon}
          {s.label}
        </button>
      ))}
    </div>
  )
}
