import { cn } from "@/lib/utils"

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
  const letters =
    parts.length > 1 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : (parts[0] ?? "?").slice(0, 2)
  return letters.toUpperCase()
}

const sizes = { sm: "size-4 text-[8px]", md: "size-5 text-[10px]", lg: "size-8 text-xs" } as const

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string
  size?: keyof typeof sizes
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-border/30 bg-muted font-medium text-subtle-foreground",
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
