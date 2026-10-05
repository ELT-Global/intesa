import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "@/lib/utils"

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
  note,
}: {
  icon?: ReactNode
  title: string
  note?: ReactNode
}) {
  return (
    <header className="flex min-h-11 items-center gap-2 border-b border-border px-4">
      {icon && <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
      <h2 className="text-sm font-medium">{title}</h2>
      {note && <div className="ml-auto text-xs text-muted-foreground">{note}</div>}
    </header>
  )
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />
}
