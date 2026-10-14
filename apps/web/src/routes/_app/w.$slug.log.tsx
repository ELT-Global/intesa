import {
  formatWeek,
  parseWeek,
  STATUS_LABELS,
  shiftWeek,
  weekCounts,
  weekCountsText,
  weekLogMarkdown,
  weekLogTasks,
  weekOf,
  weekTaskAssignedAt,
} from "@intesa/task-query"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  Copy,
  CornerDownRight,
  Hourglass,
} from "lucide-react"
import { type ReactNode, useEffect, useId, useState } from "react"
import { notify } from "@/components/mutation-error-notice"
import { EmptyState, ErrorState, PageTitle } from "@/components/page"
import { keyLabel } from "@/components/projects/shortcut-help-dialog"
import { RowsSkeleton } from "@/components/skeleton"
import { StatusIcon } from "@/components/tasks/properties"
import { TaskKey } from "@/components/tasks/task-key"
import { Avatar } from "@/components/ui/avatar"
import { Kbd } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Panel, PanelHeader } from "@/components/ui/panel"
import type { WeekPerson, WeekTask } from "@/lib/api"
import { weekLogQuery, workspacesQuery } from "@/lib/queries"
import { isPlainShortcut, useIsMac, useShortcut } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/w/$slug/log")({
  staticData: { title: "Weekly log" },
  // Any day names its week; the current week (or anything unreadable) is left out of the URL.
  validateSearch: (search: Record<string, unknown>): { week?: string } => {
    const week = typeof search.week === "string" ? parseWeek(search.week) : undefined
    return { week: week && week !== weekOf(new Date()) ? week : undefined }
  },
  head: () => ({ meta: [{ title: "Weekly log · Intesa" }] }),
  component: WeeklyLogPage,
})

// Same wording as the copied Markdown and the week label; the year only when it is not the week's.
const weekday = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short" })
function day(iso: string, weekYear: number, withWeekday = false): string {
  const date = new Date(iso)
  return date.toLocaleDateString("en-US", {
    weekday: withWeekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: date.getFullYear() === weekYear ? undefined : "numeric",
  })
}

function relativeWeek(week: string, current: string): string | undefined {
  if (week === current) return "This week"
  if (week === shiftWeek(current, -1)) return "Last week"
  if (week === shiftWeek(current, 1)) return "Next week"
  return undefined
}

const counts = (tasks: WeekTask[]) => weekCountsText(weekCounts(tasks))

/** "Todo → In progress Tue · → Review Thu": status changes inside the week, creation left out. */
function statusTrail(task: WeekTask): string | undefined {
  const parts: string[] = []
  let previous: WeekTask["status"] | null = null
  for (const change of task.changes) {
    if (change.fromStatus === null) {
      previous = change.toStatus
      continue
    }
    const to = `${STATUS_LABELS[change.toStatus]} ${weekday(change.at)}`
    const continues = parts.length > 0 && change.fromStatus === previous
    parts.push(continues ? `→ ${to}` : `${STATUS_LABELS[change.fromStatus]} → ${to}`)
    previous = change.toStatus
  }
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function TaskFacts({ task, weekYear }: { task: WeekTask; weekYear: number }) {
  const facts = [
    {
      id: "state",
      text:
        task.status === "complete" && task.completedAt
          ? `Completed ${weekday(task.completedAt)}`
          : STATUS_LABELS[task.status],
    },
    { id: "project", text: task.project.name },
    {
      id: "assigned",
      text: task.carriedOver
        ? `Carried over · since ${day(weekTaskAssignedAt(task), weekYear)}`
        : `Assigned ${day(weekTaskAssignedAt(task), weekYear, true)}`,
    },
  ]
  if (task.unassignedAt) {
    facts.push({ id: "unassigned", text: `Unassigned ${weekday(task.unassignedAt)}` })
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 pl-6.5 text-xs text-muted-foreground @2xl:shrink-0 @2xl:justify-end @2xl:pl-0">
      {facts.map((fact, i) => (
        <span key={fact.id} className="flex items-center gap-x-1.5">
          {fact.text}
          {i < facts.length - 1 && <span aria-hidden>·</span>}
        </span>
      ))}
    </span>
  )
}

function TaskRow({ slug, task, weekYear }: { slug: string; task: WeekTask; weekYear: number }) {
  const trail = statusTrail(task)
  return (
    <li>
      <Link
        to="/w/$slug/projects/$projectId"
        params={{ slug, projectId: task.project.id }}
        search={{ task: task.id }}
        className="flex flex-col gap-1 px-4 py-2 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex flex-col gap-1 @2xl:flex-row @2xl:items-center @2xl:gap-4">
          <span className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
            <StatusIcon status={task.status} />
            <TaskKey>{task.key}</TaskKey>
            <span className="min-w-0 flex-1 truncate">{task.title}</span>
          </span>
          <TaskFacts task={task} weekYear={weekYear} />
        </span>
        {trail && <span className="pl-6.5 text-[11px] text-subtle-foreground">{trail}</span>}
      </Link>
    </li>
  )
}

function TaskGroup({
  slug,
  title,
  tasks,
  weekYear,
}: {
  slug: string
  title: string
  tasks: WeekTask[]
  weekYear: number
}) {
  const id = useId()
  if (tasks.length === 0) return null
  return (
    <div>
      <h3 id={id} className="px-4 pt-3 pb-1 text-xs text-muted-foreground">
        {title}
      </h3>
      <ul aria-labelledby={id} className="divide-y divide-border/70">
        {tasks.map((t) => (
          <TaskRow key={t.id} slug={slug} task={t} weekYear={weekYear} />
        ))}
      </ul>
    </div>
  )
}

function PersonPanel({
  slug,
  person,
  weekYear,
}: {
  slug: string
  person: WeekPerson
  weekYear: number
}) {
  const completed = person.tasks.filter((t) => t.status === "complete")
  const pending = person.tasks.filter((t) => t.status !== "complete")
  return (
    <Panel aria-label={person.user.name} className="@container">
      <PanelHeader
        icon={<Avatar name={person.user.name} className="flex" />}
        title={person.user.name}
        note={person.member ? counts(person.tasks) : `Former member · ${counts(person.tasks)}`}
      />
      <div className="pb-1">
        <TaskGroup slug={slug} title="Completed" tasks={completed} weekYear={weekYear} />
        <TaskGroup slug={slug} title="Pending" tasks={pending} weekYear={weekYear} />
      </div>
    </Panel>
  )
}

function Summary({ tasks }: { tasks: WeekTask[] }) {
  const c = weekCounts(tasks)
  const tiles: { label: string; value: number; icon: ReactNode }[] = [
    { label: "Completed", value: c.completed, icon: <CircleCheck /> },
    { label: "Pending", value: c.pending, icon: <Hourglass /> },
    { label: "Carried over", value: c.carriedOver, icon: <CornerDownRight /> },
    { label: "New this week", value: c.added, icon: <CirclePlus /> },
  ]
  return (
    <dl aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-xs/5"
        >
          <dt className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            {tile.label}
            <span aria-hidden className="[&_svg]:size-3.5">
              {tile.icon}
            </span>
          </dt>
          <dd className="text-2xl font-medium leading-[1.1] tracking-[-0.02em] tabular-nums">
            {tile.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function WeekNavigator({
  week,
  current,
  onChange,
}: {
  week: string
  current: string
  onChange: (week: string) => void
}) {
  const mac = useIsMac()
  const relative = relativeWeek(week, current)
  const shift = keyLabel("Shift", mac)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        icon
        aria-label="Previous week"
        title={`Previous week (${shift}+←)`}
        aria-keyshortcuts="Shift+ArrowLeft"
        onClick={() => onChange(shiftWeek(week, -1))}
      >
        <ChevronLeft />
      </Button>
      <p aria-live="polite" className="px-1 text-sm font-medium tabular-nums">
        {relative && <span className="text-muted-foreground">{relative} · </span>}
        {formatWeek(week)}
      </p>
      <Button
        size="sm"
        icon
        aria-label="Next week"
        title={`Next week (${shift}+→)`}
        aria-keyshortcuts="Shift+ArrowRight"
        disabled={week >= current}
        onClick={() => onChange(shiftWeek(week, 1))}
      >
        <ChevronRight />
      </Button>
      {week !== current && (
        <Button variant="ghost" size="sm" onClick={() => onChange(current)}>
          This week
        </Button>
      )}
      <span aria-hidden className="ml-auto hidden items-center gap-1 md:flex">
        <Kbd>{shift}</Kbd>
        <Kbd>←</Kbd>
        <Kbd>→</Kbd>
      </span>
    </div>
  )
}

function CopyButton({ disabled, getText }: { disabled: boolean; getText: () => string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
    } catch {
      notify("Could not copy to the clipboard.", "error")
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy as Markdown"}
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Copied the week as Markdown" : ""}
      </span>
    </>
  )
}

function WeeklyLogPage() {
  const { slug } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { data: workspaces } = useSuspenseQuery(workspacesQuery)
  const workspace = workspaces.find((w) => w.slug === slug)
  const workspaceId = workspace?.id ?? ""
  const current = weekOf(new Date())
  const week = search.week ?? current
  const query = useQuery({ ...weekLogQuery(workspaceId, week), enabled: !!workspaceId })
  const log = query.data

  const goTo = (next: string) =>
    void navigate({ to: ".", search: { week: next === current ? undefined : next } })

  useShortcut(
    (e) => isPlainShortcut(e, "ArrowLeft", { shift: true }),
    () => goTo(shiftWeek(week, -1)),
  )
  useShortcut(
    (e) => week < current && isPlainShortcut(e, "ArrowRight", { shift: true }),
    () => goTo(shiftWeek(week, 1)),
  )

  const people = log?.people ?? []
  const active = people.filter((p) => p.tasks.length > 0)
  const idle = people.filter((p) => p.tasks.length === 0)
  const weekYear = Number(week.slice(0, 4))

  const markdown = () =>
    weekLogMarkdown(log ?? { people: [] }, {
      week,
      workspace: workspace?.name,
      taskUrl: (t) => `${location.origin}/w/${slug}/projects/${t.project.id}?task=${t.id}`,
    })

  return (
    <>
      <PageTitle
        title="Weekly log."
        description="Who worked on what, week by week."
        actions={<CopyButton disabled={!log || query.isPlaceholderData} getText={markdown} />}
      />
      <WeekNavigator week={week} current={current} onChange={goTo} />
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {!log && !query.isError && <RowsSkeleton />}
      {log &&
        (active.length === 0 ? (
          <EmptyState
            title="Nothing this week."
            body="Tasks assigned to people in this workspace during the week will be listed here."
          />
        ) : (
          <div
            aria-busy={query.isPlaceholderData}
            className={cn(
              "flex flex-col gap-4 transition-opacity",
              query.isPlaceholderData && "opacity-60",
            )}
          >
            <Summary tasks={weekLogTasks(active)} />
            {active.map((person) => (
              <PersonPanel key={person.user.id} slug={slug} person={person} weekYear={weekYear} />
            ))}
            {idle.length > 0 && (
              <Panel aria-label="Nothing this week">
                <PanelHeader title="Nothing this week" count={idle.length} />
                <ul className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3">
                  {idle.map((person) => (
                    <li key={person.user.id} className="flex min-w-0 items-center gap-2 text-sm">
                      <Avatar name={person.user.name} />
                      <span className="truncate">{person.user.name}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        ))}
    </>
  )
}
