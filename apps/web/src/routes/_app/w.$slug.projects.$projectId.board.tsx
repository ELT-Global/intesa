import { createFileRoute } from "@tanstack/react-router"
import { ProjectBoard } from "@/components/tasks/project-board"

export const Route = createFileRoute("/_app/w/$slug/projects/$projectId/board")({
  component: BoardPage,
})

function BoardPage() {
  const { projectId } = Route.useParams()
  return <ProjectBoard projectId={projectId} />
}
