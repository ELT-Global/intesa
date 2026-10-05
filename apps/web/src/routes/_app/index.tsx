import { createFileRoute, redirect } from "@tanstack/react-router"
import { getLastWorkspace } from "@/lib/last-workspace"
import { workspacesQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/")({
  beforeLoad: async ({ context }) => {
    const workspaces = await context.queryClient.fetchQuery(workspacesQuery)
    const last = getLastWorkspace()
    const target = workspaces.find((w) => w.slug === last) ?? workspaces[0]
    if (!target) throw redirect({ to: "/new-workspace" })
    throw redirect({ to: "/w/$slug/home", params: { slug: target.slug } })
  },
})
