import { createFileRoute } from "@tanstack/react-router"
import { EmptyState } from "@/components/page"

export const Route = createFileRoute("/_app/w/$slug/projects/$projectId/table")({
  component: () => (
    <EmptyState title="No tasks yet." body="Tasks will appear here as rows you can sort." />
  ),
})
