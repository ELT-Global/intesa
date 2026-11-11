import { STATUS_LABELS } from "@intesa/task-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { AssigneeAvatars, assigneesOf } from "@/components/bugs/assignee-avatars"
import { BugDetailSheet } from "@/components/bugs/bug-detail-sheet"
import { BugStatusBadge } from "@/components/bugs/bug-status-badge"
import { EmptyState, ErrorState } from "@/components/page"
import { RowsSkeleton } from "@/components/skeleton"
import { StatusIcon } from "@/components/tasks/properties"
import { TaskKey } from "@/components/tasks/task-key"
import { useTaskParam } from "@/components/tasks/task-param"
import { Panel } from "@/components/ui/panel"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { type BugStatus, type BugSummary, projectBugsQuery } from "@/lib/bugs"

type Filter = BugStatus | "all"

export const Route = createFileRoute("/_app/w/$slug/projects/$projectId/bugs")({
  validateSearch: (search: Record<string, unknown>): { status?: BugStatus; bug?: string } => ({
    status: search.status === "pending" || search.status === "resolved" ? search.status : undefined,
    bug: typeof search.bug === "string" && search.bug ? search.bug : undefined,
  }),
  head: () => ({ meta: [{ title: "Bugs · Intesa" }] }),
  component: BugsPage,
})

const EMPTY: Record<Filter, { title: string; body: string }> = {
  all: {
    title: "No bugs yet.",
    body: "Tag a task “bug” and it appears here, grouped with the tasks that later work on the same bug.",
  },
  pending: { title: "No pending bugs.", body: "Every bug's tasks are complete." },
  resolved: {
    title: "No resolved bugs.",
    body: "A bug is resolved once all of its tasks are complete.",
  },
}

function BugsPage() {
  const { projectId } = Route.useParams()
  const { status, bug } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const query = useQuery(projectBugsQuery(projectId, status))
  const bugs = query.data
  const filter: Filter = status ?? "all"

  const openBug = (id: string | null) =>
    void navigate({
      search: (prev) => ({ ...prev, bug: id ?? undefined }),
      replace: id === null,
    })

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <SegmentedControl<Filter>
          label="Show"
          value={filter}
          onChange={(next) =>
            void navigate({
              search: (prev) => ({ ...prev, status: next === "all" ? undefined : next }),
              replace: true,
            })
          }
          segments={[
            { value: "all", label: "All" },
            { value: "pending", label: "Pending" },
            { value: "resolved", label: "Resolved" },
          ]}
        />
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !bugs ? (
        <RowsSkeleton />
      ) : bugs.length === 0 ? (
        <EmptyState {...EMPTY[filter]} />
      ) : (
        <Panel>
          <ul aria-label="Bugs" className="divide-y divide-border">
            {bugs.map((b) => (
              <BugRow key={b.id} bug={b} onOpen={() => openBug(b.id)} />
            ))}
          </ul>
        </Panel>
      )}
      <BugDetailSheet bugId={bug ?? null} onClose={() => openBug(null)} />
    </>
  )
}

function BugRow({ bug, onOpen }: { bug: BugSummary; onOpen: () => void }) {
  const { openTask } = useTaskParam()
  return (
    <li className="flex flex-col gap-2 px-4 py-2.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TaskKey className="shrink-0">{bug.key}</TaskKey>
        <span className="min-w-0 truncate text-[13px] font-medium">{bug.title}</span>
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        <ul aria-label={`${bug.key} tasks`} className="flex flex-wrap items-center gap-1">
          {bug.tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                title={`${t.title} · ${STATUS_LABELS[t.status]}`}
                aria-label={`${t.key} ${STATUS_LABELS[t.status]}`}
                onClick={() => openTask(t.id)}
                className="inline-flex h-5.5 cursor-pointer items-center gap-1 rounded border border-border/70 bg-muted/55 px-1.5 font-mono text-[11px] text-subtle-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StatusIcon status={t.status} className="size-3" />
                {t.key}
              </button>
            </li>
          ))}
        </ul>
        <AssigneeAvatars people={assigneesOf(bug.tasks)} label={`${bug.key} assignees`} />
        <BugStatusBadge status={bug.status} />
      </div>
    </li>
  )
}
