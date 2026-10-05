import type { HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

/** Meta chip (§9.3). */
export function Chip({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-5.5 items-center gap-1 rounded border border-border/70 bg-muted/55 px-2 text-[11px] text-subtle-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function CountBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-subtle-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] text-subtle-foreground",
        className,
      )}
      {...props}
    />
  )
}
