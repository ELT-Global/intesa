import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { Columns3, Ellipsis, Plus, Table2 } from "lucide-react"
import { useState } from "react"
import { Message, PageTitle } from "@/components/page"
import { ProjectSettingsDialog } from "@/components/projects/project-settings-dialog"
import { TopBarActions } from "@/components/shell/app-shell"
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog"
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet"
import { Button, buttonClass } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { projectQuery, workspacesQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/w/$slug/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>): { task?: string } => ({
    task: typeof search.task === "string" && search.task ? search.task : undefined,
  }),
  component: ProjectLayout,
})

type View = "board" | "table"

function ProjectLayout() {
  const { slug, projectId } = Route.useParams()
  const navigate = useNavigate()
  const { data: workspaces } = useSuspenseQuery(workspacesQuery)
  const workspace = workspaces.find((w) => w.slug === slug)
  const project = useQuery(projectQuery(projectId))
  const view: View = useLocation({
    select: (l) => (l.pathname.endsWith("/table") ? "table" : "board"),
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  if (project.isError || !workspace) {
    return (
      <Message
        title="Project not found."
        body="It may have been deleted, or you may not have access."
      >
        <Link to="/w/$slug/home" params={{ slug }} className={buttonClass("outline")}>
          Go home
        </Link>
      </Message>
    )
  }
  if (!project.data) return null

  return (
    <>
      <TopBarActions>
        <SegmentedControl<View>
          label="View"
          value={view}
          onChange={(next) =>
            void navigate({
              to:
                next === "board"
                  ? "/w/$slug/projects/$projectId/board"
                  : "/w/$slug/projects/$projectId/table",
              params: { slug, projectId },
            })
          }
          segments={[
            { value: "board", label: "Board", icon: <Columns3 /> },
            { value: "table", label: "Table", icon: <Table2 /> },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" icon aria-label="Project options">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                Project settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            New task
          </Button>
        </div>
      </TopBarActions>

      <PageTitle title={project.data.name} description={project.data.description ?? undefined} />
      <Outlet />
      <CreateTaskDialog projectId={projectId} open={createOpen} onOpenChange={setCreateOpen} />
      <TaskDetailSheet />
      <ProjectSettingsDialog
        workspace={workspace}
        project={project.data}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </>
  )
}
