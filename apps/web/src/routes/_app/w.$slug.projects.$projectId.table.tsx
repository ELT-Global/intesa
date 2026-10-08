import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useMemo, useState } from "react"
import { EmptyState, ErrorState } from "@/components/page"
import { RowsSkeleton } from "@/components/skeleton"
import { useTaskParam } from "@/components/tasks/task-param"
import { TaskSearch } from "@/components/tasks/task-search"
import { TaskTable } from "@/components/tasks/task-table"
import { Panel } from "@/components/ui/panel"
import { meQuery } from "@/lib/queries"
import { compileSearch } from "@/lib/task-search"
import { projectTasksQuery } from "@/lib/tasks"

export const Route = createFileRoute("/_app/w/$slug/projects/$projectId/table")({
  component: TablePage,
})

function TablePage() {
  const { projectId } = Route.useParams()
  const { openTask } = useTaskParam()
  const onOpen = useCallback((t: { id: string }) => openTask(t.id), [openTask])
  const query = useQuery(projectTasksQuery(projectId))
  const tasks = query.data
  const meId = useQuery(meQuery).data?.id
  const [search, setSearch] = useState("")
  const visible = useMemo(() => {
    const matches = compileSearch(search, { meId })
    return matches ? tasks?.filter(matches) : tasks
  }, [tasks, search, meId])

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!tasks) return <RowsSkeleton />
  if (tasks.length === 0) {
    return <EmptyState title="No tasks yet." body="Tasks will appear here as rows you can sort." />
  }
  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <TaskSearch query={search} onChange={setSearch} tasks={tasks} />
      </div>
      {visible?.length === 0 ? (
        <EmptyState title="No matching tasks." body="Try a different search, or clear it." />
      ) : (
        <Panel>
          <TaskTable tasks={visible ?? tasks} label="Tasks" onOpen={onOpen} />
        </Panel>
      )}
    </>
  )
}
