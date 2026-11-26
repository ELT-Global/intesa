import * as P from "@radix-ui/react-popover"
import { Hourglass } from "lucide-react"
import { useState } from "react"
import { menuAnimation } from "@/components/ui/animation"
import type { TaskRef, TaskSummary } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { TaskKey } from "./task-key"

function RefList({ label, refs }: { label: string; refs: TaskRef[] }) {
  if (refs.length === 0) return null
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <ul className="flex flex-col gap-0.5">
        {refs.map((r) => (
          <li
            key={r.id}
            className={cn(
              "flex items-baseline gap-1.5 text-sm",
              r.status === "complete" && "text-muted-foreground line-through",
            )}
          >
            <TaskKey>{r.key}</TaskKey>
            <span className="min-w-0 truncate">{r.title}</span>
            {r.status === "complete" && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Hourglass on a card whose task blocks, or is blocked by, other tasks. Hovering or focusing it
 * lists them. It is not a button (the card already is one), so it opens on hover and focus
 * rather than on click.
 */
export function BlockerIndicator({ task }: { task: Pick<TaskSummary, "blockedBy" | "blocks"> }) {
  const [open, setOpen] = useState(false)
  const { blockedBy, blocks } = task
  if (blockedBy.length === 0 && blocks.length === 0) return null
  const label = [blockedBy.length > 0 && "Blocked", blocks.length > 0 && "Blocking"]
    .filter(Boolean)
    .join(" and ")
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Anchor asChild>
        {/* biome-ignore lint/a11y/useSemanticElements: the card is a button, which cannot contain one. */}
        <span
          role="img"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focus is how keyboard users reach the list.
          tabIndex={0}
          aria-label={label}
          onPointerEnter={() => setOpen(true)}
          onPointerLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            blockedBy.length > 0 && "text-warning-foreground",
          )}
        >
          <Hourglass aria-hidden className="size-3.5" />
        </span>
      </P.Anchor>
      <P.Portal>
        <P.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "pointer-events-none origin-(--radix-popover-content-transform-origin) z-50 outline-none flex w-64 max-w-[calc(100vw-1rem)] flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg/5",
            menuAnimation,
          )}
        >
          <RefList label="Blocked by" refs={blockedBy} />
          <RefList label="Blocks" refs={blocks} />
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
