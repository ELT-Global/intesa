import { createFileRoute } from "@tanstack/react-router"
import { EmptyState, PageTitle } from "@/components/page"

export const Route = createFileRoute("/_app/w/$slug/members")({
  head: () => ({ meta: [{ title: "Members · Intesa" }] }),
  component: () => (
    <>
      <PageTitle title="Members." description="The people in this workspace." />
      <EmptyState title="Just you for now." body="Invited members will be listed here." />
    </>
  ),
})
