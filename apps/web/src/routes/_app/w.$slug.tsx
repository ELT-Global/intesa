import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { useEffect } from "react"
import { Message } from "@/components/page"
import { AppShell } from "@/components/shell/app-shell"
import { Skeleton } from "@/components/skeleton"
import { buttonClass } from "@/components/ui/button"
import { setLastWorkspace } from "@/lib/last-workspace"
import { projectsQuery, workspacesQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/w/$slug")({
  loader: async ({ context, params }) => {
    const workspaces = await context.queryClient.fetchQuery(workspacesQuery)
    const workspace = workspaces.find((w) => w.slug === params.slug)
    // Sidebar needs the list as soon as the shell renders; do not wait for it here.
    if (workspace) void context.queryClient.prefetchQuery(projectsQuery(workspace.id))
    return workspaces
  },
  pendingComponent: ShellSkeleton,
  component: WorkspaceLayout,
})

function WorkspaceLayout() {
  const { slug } = Route.useParams()
  const { data: workspaces } = useSuspenseQuery(workspacesQuery)
  const workspace = workspaces.find((w) => w.slug === slug)

  useEffect(() => {
    if (workspace) setLastWorkspace(workspace.slug)
  }, [workspace])

  if (!workspace) {
    return (
      <Message title="Workspace not found." body="It may not exist, or you may not be a member.">
        <Link to="/" className={buttonClass("outline")}>
          Go home
        </Link>
      </Message>
    )
  }

  return (
    <AppShell workspace={workspace} workspaces={workspaces}>
      <Outlet />
    </AppShell>
  )
}

function ShellSkeleton() {
  return (
    <div className="flex h-dvh overflow-hidden" role="status" aria-label="Loading">
      <div className="hidden w-64 shrink-0 flex-col gap-3 border-r border-sidebar-border bg-sidebar p-2 md:flex">
        <Skeleton className="h-11" />
        <Skeleton className="h-12" />
        <Skeleton className="h-24" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-11 border-b border-border" />
        <div className="flex flex-col gap-4 px-8 py-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  )
}
