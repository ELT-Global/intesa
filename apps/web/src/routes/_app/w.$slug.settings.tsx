import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { PageTitle } from "@/components/page"
import { GithubWebhookPanel } from "@/components/settings/github"
import { workspacesQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/w/$slug/settings")({
  staticData: { title: "Settings" },
  head: () => ({ meta: [{ title: "Settings · Intesa" }] }),
  component: SettingsPage,
})

function SettingsPage() {
  const { slug } = Route.useParams()
  const { data: workspaces } = useSuspenseQuery(workspacesQuery)
  const workspace = workspaces.find((w) => w.slug === slug)
  if (!workspace) return null
  return (
    <>
      <PageTitle title="Settings." description="How this workspace connects to GitHub." />
      <div className="flex max-w-3xl flex-col gap-4">
        <GithubWebhookPanel workspaceId={workspace.id} isOwner={workspace.role === "owner"} />
      </div>
    </>
  )
}
