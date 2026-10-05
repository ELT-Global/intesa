import { createFileRoute, redirect } from "@tanstack/react-router"
import { getLastView } from "@/lib/last-view"

// Entry point for project links: sends you to the view you used last, keeping ?task.
export const Route = createFileRoute("/_app/w/$slug/projects/$projectId/")({
  beforeLoad: ({ params, search }) => {
    const to =
      getLastView(params.projectId) === "table"
        ? "/w/$slug/projects/$projectId/table"
        : "/w/$slug/projects/$projectId/board"
    throw redirect({ to, params, search: { task: search.task }, replace: true })
  },
})
