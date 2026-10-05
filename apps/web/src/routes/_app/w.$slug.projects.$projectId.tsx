import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { Columns3, Ellipsis, Plus, Table2 } from "lucide-react"
import { useState } from "react"
import { Message, PageTitle } from "@/components/page"
import { CustomFieldsDialog } from "@/components/projects/custom-fields-dialog"
import { ProjectSettingsDialog } from "@/components/projects/project-settings-dialog"
import { TopBarActions } from "@/components/shell/app-shell"
import { AssigneePicker } from "@/components/tasks/assignee-picker"
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog"
import { CustomFieldValues } from "@/components/tasks/custom-field-values"
import { TagChips, TagPicker } from "@/components/tasks/tag-picker"
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet"
import { TaskStructureSections } from "@/components/tasks/task-relations"
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
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  if (
    project.isError ||
    !workspace ||
    (project.data && project.data.workspaceId !== workspace.id)
  ) {
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

  const viewSwitcher = (
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
  )
  const optionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" icon aria-label="Project options">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>Project settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setFieldsOpen(true)}>Custom fields…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      <TopBarActions>
        <div className="hidden lg:block">{viewSwitcher}</div>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden lg:block">{optionsMenu}</div>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            <span className="max-sm:sr-only">New task</span>
          </Button>
        </div>
      </TopBarActions>

      <PageTitle title={project.data.name} description={project.data.description ?? undefined} />
      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-2 lg:hidden">
        {viewSwitcher}
        {optionsMenu}
      </div>
      <Outlet />
      <CreateTaskDialog projectId={projectId} open={createOpen} onOpenChange={setCreateOpen} />
      <TaskDetailSheet
        sections={(task) => (
          <>
            <TaskStructureSections task={task} workspaceId={workspace.id} />
            <CustomFieldValues task={task} />
          </>
        )}
        propertySlots={(task) => (
          <>
            <AssigneePicker task={task} workspaceId={workspace.id} />
            <TagPicker task={task} workspaceId={workspace.id} />
            <TagChips task={task} />
          </>
        )}
      />
      <CustomFieldsDialog projectId={projectId} open={fieldsOpen} onOpenChange={setFieldsOpen} />
      <ProjectSettingsDialog
        workspace={workspace}
        project={project.data}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </>
  )
}
