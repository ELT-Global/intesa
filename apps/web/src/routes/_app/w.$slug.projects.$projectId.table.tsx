import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback } from "react"
import { EmptyState } from "@/components/page"
import { useTaskParam } from "@/components/tasks/task-param"
import { TaskTable } from "@/components/tasks/task-table"
import { Panel } from "@/components/ui/panel"
import { projectTasksQuery } from "@/lib/tasks"

export const Route = createFileRoute("/_app/w/$slug/projects/$projectId/table")({
  component: TablePage,
})

function TablePage() {
  const { projectId } = Route.useParams()
  const { openTask } = useTaskParam()
  const onOpen = useCallback((t: { id: string }) => openTask(t.id), [openTask])
  const { data: tasks, isError } = useQuery(projectTasksQuery(projectId))

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive-foreground">
        Could not load tasks.
      </p>
    )
  }
  if (!tasks) return null
  if (tasks.length === 0) {
    return <EmptyState title="No tasks yet." body="Tasks will appear here as rows you can sort." />
  }
  return (
    <Panel>
      <TaskTable tasks={tasks} label="Tasks" onOpen={onOpen} />
    </Panel>
  )
}
