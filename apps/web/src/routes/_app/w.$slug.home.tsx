import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { EmptyState, PageTitle } from "@/components/page"
import { Panel, PanelHeader } from "@/components/ui/panel"
import { projectsQuery, workspacesQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/w/$slug/home")({
  head: () => ({ meta: [{ title: "Home · Intesa" }] }),
  component: HomePage,
})

function HomePage() {
  const { slug } = Route.useParams()
  const { data: workspaces } = useSuspenseQuery(workspacesQuery)
  const workspaceId = workspaces.find((w) => w.slug === slug)?.id ?? ""
  const { data: projects } = useQuery({ ...projectsQuery(workspaceId), enabled: !!workspaceId })

  return (
    <>
      <PageTitle title="Home." description="Your starting point in this workspace." />
      {projects && projects.length > 0 ? (
        <Panel>
          <PanelHeader title="Projects" />
          <ul className="divide-y divide-border/70">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  to="/w/$slug/projects/$projectId"
                  params={{ slug, projectId: p.id }}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                >
                  <span className="font-medium">{p.name}</span>
                  {p.description && (
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {p.description}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-subtle-foreground">
                    {p.key}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <EmptyState
          title="Nothing here yet."
          body="Create a project from the sidebar to get started."
        />
      )}
    </>
  )
}
