import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { useEffect } from "react"
import { Message } from "@/components/page"
import { AppShell } from "@/components/shell/app-shell"
import { buttonClass } from "@/components/ui/button"
import { setLastWorkspace } from "@/lib/last-workspace"
import { workspacesQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/w/$slug")({
  loader: ({ context }) => context.queryClient.fetchQuery(workspacesQuery),
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
