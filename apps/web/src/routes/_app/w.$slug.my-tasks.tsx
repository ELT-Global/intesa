import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { FolderKanban, ListTodo } from "lucide-react"
import { type ReactNode, useCallback, useMemo, useState } from "react"
import { EmptyState, PageTitle } from "@/components/page"
import { STATUS_LABELS, StatusIcon } from "@/components/tasks/properties"
import { type TableColumn, type TableTask, TaskTable } from "@/components/tasks/task-table"
import { CountBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Panel, PanelHeader } from "@/components/ui/panel"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { workspacesQuery } from "@/lib/queries"
import { type MyTask, myTasksQuery, TASK_STATUSES } from "@/lib/tasks"

type Group = "status" | "project"

export const Route = createFileRoute("/_app/w/$slug/my-tasks")({
  staticData: { title: "My Tasks" },
  validateSearch: (search: Record<string, unknown>): { group?: Group } => ({
    group: search.group === "project" ? "project" : undefined,
  }),
  head: () => ({ meta: [{ title: "My Tasks · Intesa" }] }),
  component: MyTasksPage,
})

type Section = { id: string; name: string; icon: ReactNode; tasks: MyTask[] }

const STATUS_COLUMNS: TableColumn[] = ["task", "project", "priority", "assignees", "tags", "due"]
const PROJECT_COLUMNS: TableColumn[] = ["task", "status", "priority", "assignees", "tags", "due"]

function buildSections(tasks: MyTask[], group: Group): Section[] {
  if (group === "status") {
    return TASK_STATUSES.map((s) => ({
      id: s,
      name: STATUS_LABELS[s],
      icon: <StatusIcon status={s} />,
      tasks: tasks.filter((t) => t.status === s),
    })).filter((s) => s.tasks.length > 0)
  }
  const byProject = new Map<string, Section>()
  for (const t of tasks) {
    const section: Section = byProject.get(t.project.id) ?? {
      id: t.project.id,
      name: t.project.name,
      icon: <FolderKanban />,
      tasks: [],
    }
    section.tasks.push(t)
    byProject.set(t.project.id, section)
  }
  return [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function MyTasksPage() {
  const { slug } = Route.useParams()
  const { group = "status" } = Route.useSearch()
  const navigate = useNavigate()
  const { data: workspaces } = useSuspenseQuery(workspacesQuery)
  const workspaceId = workspaces.find((w) => w.slug === slug)?.id ?? ""
  const { data: tasks } = useQuery({ ...myTasksQuery(workspaceId), enabled: !!workspaceId })
  const [showCompleted, setShowCompleted] = useState(false)

  const onOpen = useCallback(
    (t: TableTask) =>
      void navigate({
        to: "/w/$slug/projects/$projectId",
        params: { slug, projectId: t.projectId },
        search: { task: t.id },
      }),
    [navigate, slug],
  )

  const sections = useMemo(() => {
    const visible = (tasks ?? []).filter((t) => showCompleted || t.status !== "complete")
    return buildSections(visible, group)
  }, [tasks, group, showCompleted])

  return (
    <>
      <PageTitle title="My Tasks." description="Everything assigned to you." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">Group by</span>
        <SegmentedControl<Group>
          label="Group by"
          value={group}
          onChange={(next) =>
            void navigate({
              to: ".",
              search: { group: next === "project" ? "project" : undefined },
              replace: true,
            })
          }
          segments={[
            { value: "status", label: "Status", icon: <ListTodo /> },
            { value: "project", label: "Project", icon: <FolderKanban /> },
          ]}
        />
        <Button
          variant="outline"
          size="sm"
          aria-pressed={showCompleted}
          onClick={() => setShowCompleted((v) => !v)}
          className="ml-auto aria-pressed:bg-accent"
        >
          Show completed
        </Button>
      </div>
      {tasks &&
        (sections.length === 0 ? (
          <EmptyState
            title="Nothing assigned to you."
            body="Tasks assigned to you will be listed here."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {sections.map((s) => (
              <Panel key={s.id} aria-label={s.name}>
                <PanelHeader
                  icon={s.icon}
                  title={s.name}
                  note={<CountBadge>{s.tasks.length}</CountBadge>}
                />
                <TaskTable
                  tasks={s.tasks}
                  label={s.name}
                  editable={false}
                  columns={group === "status" ? STATUS_COLUMNS : PROJECT_COLUMNS}
                  onOpen={onOpen}
                />
              </Panel>
            ))}
          </div>
        ))}
    </>
  )
}
