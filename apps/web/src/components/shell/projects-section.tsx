import { useQuery } from "@tanstack/react-query"
import { Link, useLocation } from "@tanstack/react-router"
import { Bug, ChevronDown, ChevronRight, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { CreateProjectDialog } from "@/components/projects/create-project-dialog"
import { Skeleton } from "@/components/skeleton"
import type { Project, Workspace } from "@/lib/api"
import { projectsQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"

const ACTIVE = "bg-sidebar-accent text-sidebar-accent-foreground"

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
  // On a project's Bugs page its nested Bugs link is the current one, not the project's.
  const onBugs = useLocation({ select: (l) => l.pathname.endsWith("/bugs") })

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
              <ProjectItem
                key={p.id}
                project={p}
                slug={workspace.slug}
                onBugs={onBugs}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        ))}
      <CreateProjectDialog workspace={workspace} open={creating} onOpenChange={setCreating} />
    </section>
  )
}

// A project, with its Bugs link folded underneath. It unfolds by the chevron, and on its own
// whenever the project is opened.
function ProjectItem({
  project,
  slug,
  onBugs,
  onNavigate,
}: {
  project: Project
  slug: string
  onBugs: boolean
  onNavigate?: () => void
}) {
  const current = useLocation({
    select: (l) => l.pathname.startsWith(`/w/${slug}/projects/${project.id}`),
  })
  const [expanded, setExpanded] = useState(current)
  useEffect(() => {
    if (current) setExpanded(true)
  }, [current])

  return (
    <li>
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`}
          onClick={() => setExpanded((v) => !v)}
          className="touch-target inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3 transition-transform motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
        </button>
        <Link
          to="/w/$slug/projects/$projectId"
          params={{ slug, projectId: project.id }}
          onClick={onNavigate}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-[12.5px] text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          activeProps={onBugs ? undefined : { className: ACTIVE }}
        >
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
          <span className="font-mono text-[11px] text-subtle-foreground">{project.key}</span>
        </Link>
      </div>
      {expanded && (
        <Link
          to="/w/$slug/projects/$projectId/bugs"
          params={{ slug, projectId: project.id }}
          onClick={onNavigate}
          className="ml-5 flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          activeProps={{ className: ACTIVE }}
        >
          <Bug aria-hidden className="size-3" />
          Bugs
        </Link>
      )}
    </li>
  )
}
