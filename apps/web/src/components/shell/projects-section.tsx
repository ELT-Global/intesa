import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

/** Collapsible project list. Pass `children` to render project rows; empty for now. */
export function ProjectsSection({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section aria-label="Projects">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mb-1 mt-1 flex w-full cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        Projects
        <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
      </button>
      {open &&
        (children ?? (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">No projects yet.</p>
        ))}
    </section>
  )
}
