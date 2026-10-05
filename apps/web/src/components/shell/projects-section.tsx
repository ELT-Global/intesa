import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronDown, Plus } from "lucide-react"
import { useState } from "react"
import { CreateProjectDialog } from "@/components/projects/create-project-dialog"
import { Skeleton } from "@/components/skeleton"
import type { Workspace } from "@/lib/api"
import { projectsQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"

export function ProjectsSection({
  workspace,
  onNavigate,
}: {
  workspace: Workspace
  onNavigate?: () => void
}) {
  const [open, setOpen] = useState(true)
  const [creating, setCreating] = useState(false)
  const list = useQuery(projectsQuery(workspace.id))
  const projects = list.data

  return (
    <section aria-label="Projects">
      <div className="mb-1 mt-1 flex items-center gap-1 px-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 cursor-pointer items-center gap-1 rounded-md text-left text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          Projects
          <ChevronDown
            className={cn(
              "size-3 transition-transform motion-reduce:transition-none",
              !open && "-rotate-90",
            )}
          />
        </button>
        <button
          type="button"
          aria-label="Add project"
          onClick={() => setCreating(true)}
          className="touch-target inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {open &&
        (list.isError ? (
          <button
            type="button"
            onClick={() => void list.refetch()}
            className="px-2 py-1 text-left text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Couldn't load projects. Try again
          </button>
        ) : !projects ? (
          <div role="status" aria-label="Loading projects" className="flex flex-col gap-1 px-2">
            <Skeleton className="h-5" />
            <Skeleton className="h-5" />
          </div>
        ) : projects.length === 0 ? (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">No projects yet.</p>
        ) : (
          <ul className="flex flex-col gap-px">
            {projects?.map((p) => (
              <li key={p.id}>
                <Link
                  to="/w/$slug/projects/$projectId"
                  params={{ slug: workspace.slug, projectId: p.id }}
                  onClick={onNavigate}
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="font-mono text-[11px] text-subtle-foreground">{p.key}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
      <CreateProjectDialog workspace={workspace} open={creating} onOpenChange={setCreating} />
    </section>
  )
}
