import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Task identifier such as WEB-12. */
export function TaskKey({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("font-mono text-[11px] text-subtle-foreground", className)}>
      {children}
    </span>
  )
}
