import { useQuery } from "@tanstack/react-query"
import { EmptyState, Message } from "@/components/page"
import { projectTasksQuery } from "@/lib/tasks"
import { TaskCard } from "./task-card"
import { useTaskParam } from "./task-param"

/** Top-level tasks of a project as a responsive grid of cards. */
export function ProjectBoard({ projectId }: { projectId: string }) {
  const tasks = useQuery(projectTasksQuery(projectId))
  const { openTask } = useTaskParam()

  if (tasks.isError) {
    return <Message title="Couldn't load tasks." body={tasks.error.message} />
  }
  if (!tasks.data) return null
  if (tasks.data.length === 0) {
    return <EmptyState title="No tasks yet." body="Create a task to get started." />
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tasks.data.map((task) => (
        <li key={task.id}>
          <TaskCard task={task} onOpen={openTask} />
        </li>
      ))}
    </ul>
  )
}
