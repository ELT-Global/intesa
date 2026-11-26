import { useState } from "react"
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

const sizes = {
  sm: "size-4 text-[10px] leading-none",
  md: "size-5 text-[10px]",
  lg: "size-8 text-xs",
  xl: "size-16 text-lg",
} as const

export function Avatar({
  name,
  src,
  size = "md",
  className,
  labelled,
}: {
  name: string
  /** The person's picture; initials are shown without one, or when it fails to load. */
  src?: string | null
  size?: keyof typeof sizes
  className?: string
  /** Exposes the person's name to assistive tech; decorative otherwise (the name is usually beside it). */
  labelled?: boolean
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const showImage = Boolean(src) && failed !== src
  return (
    <span
      {...(labelled ? { role: "img", "aria-label": name } : { "aria-hidden": true })}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/30 bg-muted font-medium text-subtle-foreground",
        sizes[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          // Google serves profile pictures only without a referrer from other sites.
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(src ?? null)}
        />
      ) : (
        initials(name)
      )}
    </span>
  )
}
