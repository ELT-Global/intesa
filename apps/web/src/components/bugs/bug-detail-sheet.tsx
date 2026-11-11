import { STATUS_LABELS } from "@intesa/task-query"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Plus, X } from "lucide-react"
import { ErrorState } from "@/components/page"
import { Skeleton } from "@/components/skeleton"
import { DescriptionField, EditableText } from "@/components/tasks/editable-fields"
import { StatusIcon } from "@/components/tasks/properties"
import { TaskKey } from "@/components/tasks/task-key"
import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { ApiError } from "@/lib/api"
import {
  type BugDetail,
  bugQuery,
  useDeleteBugImage,
  useOpenRegression,
  useUpdateBug,
  useUploadBugImage,
} from "@/lib/bugs"
import { cn } from "@/lib/utils"
import { BugStatusBadge } from "./bug-status-badge"

/** Right-hand sheet (full screen on mobile) showing one bug, laid out like the task sheet. */
export function BugDetailSheet({ bugId, onClose }: { bugId: string | null; onClose: () => void }) {
  const query = useQuery({
    ...bugQuery(bugId ?? ""),
    enabled: bugId !== null,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
  const bug = query.data
  const notFound = query.error instanceof ApiError && query.error.status === 404

  return (
    <Sheet open={bugId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => {
          if (e.target instanceof HTMLElement && e.target.matches("[data-keeps-escape]"))
            e.preventDefault()
        }}
        className={cn(
          "z-40 w-full overflow-hidden bg-background text-foreground",
          "md:w-[min(40rem,100vw)] md:border-l md:border-border md:shadow-2xl md:ring-1 md:ring-black/5",
        )}
      >
        <SheetTitle className="sr-only">{bug?.key ?? "Bug"}</SheetTitle>
        <header className="flex min-h-12 items-center gap-2 border-b border-border px-4">
          {bug && <TaskKey className="text-xs">{bug.key}</TaskKey>}
          <span className="flex-1" />
          <SheetClose asChild>
            <Button variant="ghost" size="sm" icon aria-label="Close">
              <X />
            </Button>
          </SheetClose>
        </header>
        {bug ? (
          <BugBody key={bug.id} bug={bug} />
        ) : query.isPending ? (
          <div role="status" aria-label="Loading bug" className="flex flex-col gap-4 p-6">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : notFound ? (
          <div className="flex flex-col items-start gap-3 p-6 text-sm text-muted-foreground">
            <p>This bug doesn't exist any more. A bug goes once none of its tasks is tagged bug.</p>
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function BugBody({ bug }: { bug: BugDetail }) {
  const navigate = useNavigate()
  const update = useUpdateBug(bug.id)
  const upload = useUploadBugImage(bug.id)
  const deleteImage = useDeleteBugImage(bug.id)
  const regression = useOpenRegression(bug.id)
  const patch = (p: { title?: string; body?: string | null }, revert: () => void) =>
    update.mutate(p, { onError: revert })
  const openTask = (taskId: string) =>
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, bug: undefined, task: taskId }),
    })
  const first = bug.tasks[0]
  const open = bug.tasks.find((t) => t.status !== "complete")

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <BugStatusBadge status={bug.status} />
        <div className="ml-auto flex items-center gap-2">
          {open && (
            <span id="regression-hint" className="text-xs text-muted-foreground">
              Complete {open.key} first
            </span>
          )}
          <Button
            size="sm"
            disabled={!!open || regression.isPending}
            aria-describedby={open ? "regression-hint" : undefined}
            onClick={() =>
              regression.mutate(undefined, { onSuccess: ({ task }) => openTask(task.id) })
            }
          >
            <Plus />
            Open regression task
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-7 p-6">
        {bug.mirroring && first && (
          <p className="-mb-4 text-xs text-muted-foreground">
            Follows <TaskKey className="text-[inherit]">{first.key}</TaskKey> until edited
          </p>
        )}
        <EditableText
          label="Bug title"
          value={bug.title}
          required
          onCommit={(title, revert) => patch({ title }, revert)}
          className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]"
        />
        <DescriptionField
          value={bug.body ?? ""}
          onCommit={(body, revert) => patch({ body: body || null }, revert)}
          upload={upload}
          discard={(id) => deleteImage.mutate(id)}
        />
        <section aria-labelledby="bug-tasks" className="flex flex-col gap-2">
          <h2 id="bug-tasks" className="text-xs font-medium text-muted-foreground">
            Tasks
          </h2>
          <ul aria-label="Bug tasks" className="flex flex-col gap-px">
            {bug.tasks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => openTask(t.id)}
                  className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <StatusIcon status={t.status} />
                  <TaskKey className="shrink-0">{t.key}</TaskKey>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {STATUS_LABELS[t.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
