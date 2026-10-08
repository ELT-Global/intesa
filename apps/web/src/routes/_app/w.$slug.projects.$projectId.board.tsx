import { createFileRoute } from "@tanstack/react-router"
import { ProjectBoard } from "@/components/tasks/project-board"

export const Route = createFileRoute("/_app/w/$slug/projects/$projectId/board")({
  staticData: { fullBleed: true },
  component: BoardPage,
})

function BoardPage() {
  const { projectId } = Route.useParams()
  // Keyed so the saved filter is re-read when switching projects.
  return <ProjectBoard key={projectId} projectId={projectId} />
}
