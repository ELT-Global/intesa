import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { CalendarClock, FolderKanban, UserRound } from "lucide-react"
import type { ReactNode } from "react"
import { ErrorState, PageTitle } from "@/components/page"
import { Skeleton } from "@/components/skeleton"
import { DueDateChip, PriorityIcon, StatusIcon } from "@/components/tasks/properties"
import { Panel, PanelHeader } from "@/components/ui/panel"
import type { HomeData } from "@/lib/api"
import { homeQuery, workspacesQuery } from "@/lib/queries"

export const Route = createFileRoute("/_app/w/$slug/home")({
  staticData: { title: "Home" },
  head: () => ({ meta: [{ title: "Home · Intesa" }] }),
  component: HomePage,
})

type HomeTask = HomeData["assigned"][number]

const rowClass =
  "flex items-center gap-2.5 px-4 py-2 text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"

function HomePanel({
  title,
  icon,
  empty,
  children,
  count,
}: {
  title: string
  icon: ReactNode
  empty: string
  children: ReactNode
  count: number
}) {
  return (
    <Panel aria-label={title}>
      <PanelHeader icon={icon} title={title} />
      {count === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/70">{children}</ul>
      )}
    </Panel>
  )
}

function TaskRow({ slug, task }: { slug: string; task: HomeTask }) {
  return (
    <li>
      <Link
        to="/w/$slug/projects/$projectId"
        params={{ slug, projectId: task.project.id }}
        search={{ task: task.id }}
        className={rowClass}
      >
        <StatusIcon status={task.status} />
        <span className="font-mono text-[11px] text-subtle-foreground">{task.key}</span>
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        {task.priority && <PriorityIcon priority={task.priority} />}
        {task.dueAt && <DueDateChip dueAt={task.dueAt} status={task.status} />}
      </Link>
    </li>
  )
}

function HomePage() {
  const { slug } = Route.useParams()
  const { data: workspaces } = useSuspenseQuery(workspacesQuery)
  const workspaceId = workspaces.find((w) => w.slug === slug)?.id ?? ""
  const home = useQuery({ ...homeQuery(workspaceId), enabled: !!workspaceId })
  const data = home.data

  return (
    <>
      <PageTitle title="Home." description="Your starting point in this workspace." />
      {home.isError && <ErrorState error={home.error} onRetry={() => void home.refetch()} />}
      {!data && !home.isError && (
        <div role="status" aria-label="Loading" className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-40 lg:col-span-2" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <HomePanel
              title="Recent projects"
              icon={<FolderKanban />}
              empty="Nothing here yet. Create a project from the sidebar."
              count={data.projects.length}
            >
              {data.projects.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/w/$slug/projects/$projectId"
                    params={{ slug, projectId: p.id }}
                    className={rowClass}
                  >
                    <span className="font-medium">{p.name}</span>
                    {p.description && (
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {p.description}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-subtle-foreground">
                      {p.key}
                    </span>
                  </Link>
                </li>
              ))}
            </HomePanel>
          </div>
          <HomePanel
            title="Assigned to you"
            icon={<UserRound />}
            empty="Nothing assigned to you right now."
            count={data.assigned.length}
          >
            {data.assigned.map((t) => (
              <TaskRow key={t.id} slug={slug} task={t} />
            ))}
          </HomePanel>
          <HomePanel
            title="Due soon"
            icon={<CalendarClock />}
            empty="Nothing due in the next week."
            count={data.dueSoon.length}
          >
            {data.dueSoon.map((t) => (
              <TaskRow key={t.id} slug={slug} task={t} />
            ))}
          </HomePanel>
        </div>
      )}
    </>
  )
}
