import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Link2, X } from "lucide-react"
import {
  type FormEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react"
import { Button } from "@/components/ui/button"
import {
  type RelationType,
  type TaskDetail,
  type TaskRef,
  taskQuery,
  taskSearchQuery,
  useChangeRelationship,
  useCreateSubtask,
} from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { PickerPopover } from "./picker-popover"
import { StatusIcon } from "./properties"
import { SubtaskRow } from "./subtask-row"
import { TaskKey } from "./task-key"
import { useTaskParam } from "./task-param"

/** Sheet sections for subtask and relationship management; pass from the sheet's `sections` slot. */
export function TaskStructureSections({
  task,
  workspaceId,
}: {
  task: TaskDetail
  workspaceId: string
}) {
  return (
    <>
      {!task.parent && <SubtasksSection task={task} workspaceId={workspaceId} />}
      <RelationshipsSection task={task} workspaceId={workspaceId} />
    </>
  )
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-medium">{children}</h3>
      {aside}
    </div>
  )
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 -rotate-90 text-muted-foreground">
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={c}
        strokeDashoffset={total ? c * (1 - done / total) : c}
      />
    </svg>
  )
}

function SubtasksSection({ task, workspaceId }: { task: TaskDetail; workspaceId: string }) {
  const { openTask } = useTaskParam()
  const create = useCreateSubtask(task)
  const [title, setTitle] = useState("")
  const done = task.subtasks.filter((s) => s.status === "complete").length

  function add(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || create.isPending) return
    create.mutate(trimmed, { onSuccess: () => setTitle("") })
  }

  return (
    <section aria-label="Subtasks" className="flex flex-col gap-2">
      <SectionTitle
        aside={
          task.subtasks.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-subtle-foreground">
              <ProgressRing done={done} total={task.subtasks.length} />
              {done}/{task.subtasks.length}
            </span>
          )
        }
      >
        Subtasks
      </SectionTitle>
      {task.subtasks.length > 0 && (
        <ul className="flex flex-col">
          {task.subtasks.map((s) => (
            <SubtaskRow
              key={s.id}
              parent={task}
              subtask={s}
              workspaceId={workspaceId}
              onOpen={() => openTask(s.id)}
            />
          ))}
        </ul>
      )}
      <form onSubmit={add}>
        <input
          aria-label="Add subtask"
          placeholder="Add subtask"
          value={title}
          maxLength={200}
          autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
          className="h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-[13px] outline-none placeholder:text-muted-foreground hover:bg-muted/40 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/24 dark:focus-visible:ring-ring/48"
        />
      </form>
    </section>
  )
}

/** Opens a task from a relationship; a task in another project switches to that project. */
function useOpenTaskRef(currentProjectId: string) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { slug } = useParams({ strict: false })
  const { openTask } = useTaskParam()
  // A mutation, so a failed lookup is reported by the shared error notice.
  const open = useMutation({
    meta: { errorNotice: "Could not open that task." },
    mutationFn: (ref: TaskRef) => qc.fetchQuery({ ...taskQuery(ref.id), staleTime: 30_000 }),
    onSuccess: (other, ref) => {
      if (other.projectId === currentProjectId || !slug) return openTask(ref.id)
      // The project index route sends you to the view you used last there, keeping ?task.
      void navigate({
        to: "/w/$slug/projects/$projectId",
        params: { slug, projectId: other.projectId },
        search: { task: ref.id },
      })
    },
  })
  return (ref: TaskRef) => open.mutate(ref)
}

const GROUPS: { type: RelationType; label: string; field: "blockedBy" | "blocks" | "related" }[] = [
  { type: "blocked_by", label: "Blocked by", field: "blockedBy" },
  { type: "blocks", label: "Blocks", field: "blocks" },
  { type: "related", label: "Related", field: "related" },
]

function RelationshipsSection({ task, workspaceId }: { task: TaskDetail; workspaceId: string }) {
  const change = useChangeRelationship(task.id)
  const openRef = useOpenTaskRef(task.projectId)
  const groups = GROUPS.map((g) => ({ ...g, refs: task[g.field] })).filter((g) => g.refs.length > 0)
  const total = groups.reduce((n, g) => n + g.refs.length, 0)

  // After a removal the focused button disappears; hand focus to its neighbour, else to "Add".
  const root = useRef<HTMLElement>(null)
  const afterRemove = useRef<{ index: number; total: number } | null>(null)
  useEffect(() => {
    const pending = afterRemove.current
    if (!pending || total >= pending.total) return
    afterRemove.current = null
    const buttons = root.current?.querySelectorAll<HTMLElement>("[data-remove-relationship]")
    const target = buttons?.[Math.min(pending.index, (buttons?.length ?? 1) - 1)]
    ;(target ?? root.current?.querySelector<HTMLElement>("[data-add-relationship]"))?.focus()
  }, [total])

  function remove(type: RelationType, otherId: string, button: HTMLElement) {
    const all = [...(root.current?.querySelectorAll("[data-remove-relationship]") ?? [])]
    afterRemove.current = { index: all.indexOf(button), total }
    change.mutate(
      { action: "remove", type, otherId },
      {
        onError: () => {
          afterRemove.current = null
        },
      },
    )
  }

  return (
    <section ref={root} aria-label="Relationships" className="flex flex-col gap-3">
      <SectionTitle>Relationships</SectionTitle>
      {groups.map((g) => (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset brings borders and padding we would undo
        <div key={g.type} role="group" aria-label={g.label} className="flex flex-col">
          <p className="mb-0.5 text-xs text-muted-foreground">{g.label}</p>
          <ul>
            {g.refs.map((ref) => (
              <li key={ref.id} className="flex items-center gap-1 rounded-md hover:bg-accent/60">
                <button
                  type="button"
                  onClick={() => openRef(ref)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded py-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <StatusIcon status={ref.status} />
                  <TaskKey>{ref.key}</TaskKey>
                  <span className="truncate">{ref.title}</span>
                </button>
                <Button
                  variant="ghost"
                  size="xs"
                  icon
                  aria-label={`Remove ${ref.key}`}
                  data-remove-relationship
                  onClick={(e) => remove(g.type, ref.id, e.currentTarget)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>
        <AddRelationship
          task={task}
          workspaceId={workspaceId}
          onAdd={(type, other) => change.mutate({ action: "add", type, otherId: other.id })}
        />
      </div>
    </section>
  )
}

function AddRelationship({
  task,
  workspaceId,
  onAdd,
}: {
  task: TaskDetail
  workspaceId: string
  onAdd: (type: RelationType, other: TaskRef) => void
}) {
  const [type, setType] = useState<RelationType>("blocked_by")
  const [filter, setFilter] = useState("")
  const [open, setOpen] = useState(false)
  const q = useDeferredValue(filter.trim())
  const results = useQuery({ ...taskSearchQuery(workspaceId, q), enabled: open })

  const taken = new Set([
    task.id,
    ...task.blockedBy.map((r) => r.id),
    ...task.blocks.map((r) => r.id),
    ...task.related.map((r) => r.id),
  ])
  const options = (results.data ?? [])
    .filter((r) => !taken.has(r.id))
    .map((r) => ({
      id: r.id,
      label: `${r.key} ${r.title}`,
      content: (
        <>
          <StatusIcon status={r.status} />
          <TaskKey>{r.key}</TaskKey>
          <span className="truncate">{r.title}</span>
        </>
      ),
      onSelect: () => onAdd(type, r),
    }))

  return (
    <PickerPopover
      label="Add relationship"
      placeholder="Search tasks"
      empty={results.isPending ? "Searching." : "No matching tasks."}
      filter={filter}
      onFilterChange={setFilter}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setFilter("")
      }}
      options={options}
      leading={
        <div className="mb-1 flex gap-1">
          {GROUPS.map((g) => (
            <button
              key={g.type}
              type="button"
              aria-pressed={type === g.type}
              onClick={() => setType(g.type)}
              className={cn(
                "touch-target h-6 flex-1 cursor-pointer rounded-md px-1.5 text-xs font-medium text-muted-foreground outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
                type === g.type && "bg-accent text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      }
      trigger={
        <Button variant="ghost" size="sm" className="text-foreground" data-add-relationship>
          <Link2 />
          Add relationship
        </Button>
      }
    />
  )
}
