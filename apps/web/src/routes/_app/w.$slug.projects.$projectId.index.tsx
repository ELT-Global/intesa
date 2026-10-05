import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/w/$slug/projects/$projectId/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$slug/projects/$projectId/board", params, replace: true })
  },
})
