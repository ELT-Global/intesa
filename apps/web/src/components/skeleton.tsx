import { cn } from "@/lib/utils"

/** Calm placeholder block: a hairline-bordered muted fill, no shimmer. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("rounded-md border border-border/70 bg-muted/40", className)} />
  )
}

/** Stand-in for a page title plus a panel of rows. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <RowsSkeleton rows={rows} />
    </div>
  )
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}
