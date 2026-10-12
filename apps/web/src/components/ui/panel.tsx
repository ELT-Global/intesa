import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { CountBadge } from "./badge"

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-xs/5",
        className,
      )}
      {...props}
    />
  )
}

export function PanelHeader({
  icon,
  title,
  count,
  note,
}: {
  icon?: ReactNode
  title: string
  count?: ReactNode
  note?: ReactNode
}) {
  return (
    <header className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border px-4 py-1.5">
      {icon && <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
      <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2>
      {count !== undefined && <CountBadge>{count}</CountBadge>}
      {note && <div className="ml-auto text-xs text-muted-foreground">{note}</div>}
    </header>
  )
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />
}
