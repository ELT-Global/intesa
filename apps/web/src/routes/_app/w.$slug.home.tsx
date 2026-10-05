import { createFileRoute } from "@tanstack/react-router"
import { EmptyState, PageTitle } from "@/components/page"

export const Route = createFileRoute("/_app/w/$slug/home")({
  head: () => ({ meta: [{ title: "Home · Intesa" }] }),
  component: () => (
    <>
      <PageTitle title="Home." description="Your starting point in this workspace." />
      <EmptyState
        title="Nothing here yet."
        body="Active projects and the tasks assigned to you will show up here."
      />
    </>
  ),
})
