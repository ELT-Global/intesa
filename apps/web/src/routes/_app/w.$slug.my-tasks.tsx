import { createFileRoute } from "@tanstack/react-router"
import { EmptyState, PageTitle } from "@/components/page"

export const Route = createFileRoute("/_app/w/$slug/my-tasks")({
  head: () => ({ meta: [{ title: "My Tasks · Intesa" }] }),
  component: () => (
    <>
      <PageTitle title="My Tasks." description="Everything assigned to you." />
      <EmptyState title="No tasks yet." body="Tasks assigned to you will be listed here." />
    </>
  ),
})
