import { nextSort, orderBy, type Sort, STATUS_LABELS } from "@intesa/task-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"
import { AssigneeAvatars, assigneesOf } from "@/components/bugs/assignee-avatars"
import { BugDetailSheet } from "@/components/bugs/bug-detail-sheet"
import { BugStatusBadge } from "@/components/bugs/bug-status-badge"
import { EmptyState, ErrorState } from "@/components/page"
import { RowsSkeleton } from "@/components/skeleton"
import { StatusIcon } from "@/components/tasks/properties"
import { useTaskParam } from "@/components/tasks/task-param"
import { Input } from "@/components/ui/input"
import { Panel } from "@/components/ui/panel"
import { SegmentedControl } from "@/components/ui/segmented-control"
import {
  tableCell as cell,
  Dash,
  SortHeader,
  tableFirstCell,
  tableRow,
} from "@/components/ui/table"
import { Timestamp } from "@/components/ui/timestamp"
import {
  type BugState,
  type BugStatus,
  type BugSummary,
  bugMatches,
  bugState,
  projectBugsQuery,
} from "@/lib/bugs"
import { cn } from "@/lib/utils"

type Filter = BugStatus | "all"

export const Route = createFileRoute("/_app/w/$slug/projects/$projectId/bugs")({
  validateSearch: (search: Record<string, unknown>): { status?: BugStatus; bug?: string } => ({
    status: search.status === "pending" || search.status === "resolved" ? search.status : undefined,
    bug: typeof search.bug === "string" && search.bug ? search.bug : undefined,
  }),
  staticData: { wide: true },
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

type Column = "bug" | "tasks" | "people" | "status" | "raised" | "fixed"
type SortKey = Exclude<Column, "tasks" | "people">

const COLUMNS: { column: Column; label: string; sortable?: boolean }[] = [
  { column: "bug", label: "Bug", sortable: true },
  { column: "tasks", label: "Tasks" },
  { column: "people", label: "Worked on by" },
  { column: "status", label: "Status", sortable: true },
  { column: "raised", label: "Raised", sortable: true },
  { column: "fixed", label: "Fixed", sortable: true },
]

const STATE_RANK: Record<BugState, number> = { pending: 0, regressed: 1, resolved: 2 }

// Like the task table, a bug with no fix yet sorts last whichever the direction.
const compareBugs = (sort: Sort<SortKey>) =>
  orderBy((b: BugSummary) => {
    switch (sort.key) {
      case "bug":
        return b.number
      case "status":
        return STATE_RANK[bugState(b)]
      case "raised":
        return b.createdAt
      case "fixed":
        return b.fixedAt
    }
  }, sort.dir)

function BugsPage() {
  const { projectId } = Route.useParams()
  const { status, bug } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const query = useQuery(projectBugsQuery(projectId, status))
  const bugs = query.data
  const filter: Filter = status ?? "all"
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort<SortKey> | null>(null)
  // Unsorted, the API's order: pending first, then the newest.
  const rows = useMemo(() => {
    const matching = bugs?.filter((b) => bugMatches(b, search))
    return sort ? matching?.sort(compareBugs(sort)) : matching
  }, [bugs, search, sort])

  const openBug = (id: string | null) =>
    void navigate({
      search: (prev) => ({ ...prev, bug: id ?? undefined }),
      replace: id === null,
    })

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <div className="relative min-w-0 flex-1 sm:max-w-80">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search bugs"
            placeholder="Search bugs and their tasks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-8 text-[13px] pointer-coarse:h-9"
          />
        </div>
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !bugs || !rows ? (
        <RowsSkeleton />
      ) : bugs.length === 0 ? (
        <EmptyState {...EMPTY[filter]} />
      ) : rows.length === 0 ? (
        <EmptyState title="No matching bugs." body="Try a different search, or clear it." />
      ) : (
        <Panel>
          {/* relative: keeps the cells' sr-only text inside this scroller */}
          <div className="relative overflow-x-auto">
            <table aria-label="Bugs" className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {COLUMNS.map((c, i) => (
                    <SortHeader
                      key={c.column}
                      label={c.label}
                      sortKey={c.sortable ? (c.column as SortKey) : undefined}
                      sort={sort}
                      onSort={(key) => setSort((s) => nextSort(s, key))}
                      first={i === 0}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <BugRow key={b.id} bug={b} onOpen={() => openBug(b.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <BugDetailSheet bugId={bug ?? null} onClose={() => openBug(null)} />
    </>
  )
}

function BugRow({ bug, onOpen }: { bug: BugSummary; onOpen: () => void }) {
  const { openTask } = useTaskParam()
  return (
    <tr
      // Plain cell clicks open the bug, like rows of the task table.
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) onOpen()
      }}
      className={tableRow}
    >
      <td className={cn(cell, tableFirstCell)}>
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full min-w-40 cursor-pointer items-baseline gap-2 text-left outline-none focus-visible:underline"
        >
          <span className="shrink-0 whitespace-nowrap font-mono text-[12.5px] text-subtle-foreground">
            {bug.key}
          </span>
          <span className="truncate font-medium text-foreground">{bug.title}</span>
        </button>
      </td>
      <td className={cell}>
        <ul aria-label={`${bug.key} tasks`} className="flex items-center gap-1">
          {bug.tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                title={`${t.title} · ${STATUS_LABELS[t.status]}`}
                aria-label={`${t.key} ${STATUS_LABELS[t.status]}`}
                onClick={() => openTask(t.id)}
                className="inline-flex h-5.5 cursor-pointer items-center gap-1 whitespace-nowrap rounded border border-border/70 bg-muted/55 px-1.5 font-mono text-[11px] text-subtle-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StatusIcon status={t.status} className="size-3" />
                {t.key}
              </button>
            </li>
          ))}
        </ul>
      </td>
      <td className={cell}>
        {bug.tasks.some((t) => t.assignees.length > 0) ? (
          <AssigneeAvatars people={assigneesOf(bug.tasks)} label={`${bug.key} worked on by`} />
        ) : (
          <Dash />
        )}
      </td>
      <td className={cn(cell, "whitespace-nowrap")}>
        <BugStatusBadge bug={bug} />
      </td>
      <td className={cn(cell, "whitespace-nowrap text-muted-foreground")}>
        <Timestamp iso={bug.createdAt} />
      </td>
      <td className={cn(cell, "whitespace-nowrap text-muted-foreground")}>
        {bug.fixedAt ? <Timestamp iso={bug.fixedAt} /> : <Dash />}
      </td>
    </tr>
  )
}
