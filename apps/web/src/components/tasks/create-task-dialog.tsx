import { MarkdownEditor } from "@intesa/markdown-editor"
import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { Kbd } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormError } from "@/components/ui/field"
import { ApiError } from "@/lib/api"
import { membersQuery, meQuery, projectQuery } from "@/lib/queries"
import type { Tag } from "@/lib/tags"
import {
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
  type UserRef,
  useCreateTask,
} from "@/lib/tasks"
import { AssigneePicker } from "./assignee-picker"
import { DuePicker, PriorityPicker, StatusPicker } from "./properties"
import { TagDot } from "./tag-chip"
import { TagPicker } from "./tag-picker"
import { newTaskAssigneeIds } from "./use-board-assignee-filter"

export function CreateTaskDialog({
  projectId,
  open,
  onOpenChange,
  defaultStatus,
  onCreated,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultStatus?: TaskStatus
  onCreated?: (task: TaskSummary) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(40rem,calc(100vw-2rem))] p-0">
        <DialogHeader className="mb-0 flex-row items-start gap-2 px-5 pt-5">
          <div className="flex flex-1 flex-col gap-1">
            <DialogTitle>New task</DialogTitle>
            <DialogDescription className="sr-only">
              Describe the task. Only the title is required.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" icon aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </DialogHeader>
        <CreateTaskForm
          projectId={projectId}
          defaultStatus={defaultStatus}
          onDone={(task, keepOpen) => {
            if (!keepOpen) onOpenChange(false)
            onCreated?.(task)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

const isMac = () => {
  if (typeof navigator === "undefined") return false
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform
  return /mac/i.test(platform ?? navigator.userAgent)
}

// Mounted only while the dialog is open, so the form state resets on every open.
function CreateTaskForm({
  projectId,
  defaultStatus,
  onDone,
}: {
  projectId: string
  defaultStatus?: TaskStatus
  onDone: (task: TaskSummary, keepOpen: boolean) => void
}) {
  const workspaceId = useQuery(projectQuery(projectId)).data?.workspaceId
  const create = useCreateTask(projectId)
  const titleRef = useRef<HTMLInputElement>(null)
  const moreId = useId()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<TaskStatus>(defaultStatus ?? "todo")
  const [priority, setPriority] = useState<TaskPriority | null>(null)
  const [dueAt, setDueAt] = useState<string | null>(null)
  // Ctrl+Enter in the date field commits the date and submits in one event; the form must see
  // the committed value, not the one from the render that registered the handler.
  const dueRef = useRef<string | null>(null)
  const changeDue = (next: string | null) => {
    dueRef.current = next
    setDueAt(next)
  }
  const [assignees, setAssignees] = useState<UserRef[]>([])
  // Pre-select the assignee implied by the board filter once the member list is known, unless the
  // person has already picked someone themselves.
  const members = useQuery({ ...membersQuery(workspaceId ?? ""), enabled: !!workspaceId }).data
  const meId = useQuery(meQuery).data?.id
  const assigneeSeeded = useRef(false)
  useEffect(() => {
    if (assigneeSeeded.current || !members || !meId) return
    assigneeSeeded.current = true
    const ids = newTaskAssigneeIds(projectId, meId, new Set(members.map((m) => m.userId)))
    setAssignees(
      members
        .filter((m) => ids.includes(m.userId))
        .map((m) => ({ id: m.userId, name: m.name, avatarUrl: m.avatarUrl })),
    )
  }, [members, meId, projectId])
  const [tags, setTags] = useState<Tag[]>([])
  const [createMore, setCreateMore] = useState(false)
  const [created, setCreated] = useState<string | null>(null)

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || create.isPending) return
    create.mutate(
      {
        title: trimmed,
        status,
        body: body.trim() || undefined,
        priority,
        dueAt: dueRef.current,
        assigneeIds: assignees.length ? assignees.map((a) => a.id) : undefined,
        tagIds: tags.length ? tags.map((t) => t.id) : undefined,
      },
      {
        onSuccess: (task) => {
          if (createMore) {
            setTitle("")
            setBody("")
            setCreated(task.key)
            titleRef.current?.focus()
          }
          onDone(task, createMore)
        },
      },
    )
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter") return
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      return submit()
    }
    // Enter in the date field commits the date; it must not submit the whole form.
    if (e.target instanceof HTMLInputElement && e.target.type === "date") e.preventDefault()
  }

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-col">
      <div className="flex flex-col gap-2 px-5 pt-4">
        <input
          ref={titleRef}
          aria-label="Title"
          placeholder="Task title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setCreated(null)
          }}
          maxLength={200}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the composer exists to type a title
          autoFocus
          className="w-full bg-transparent text-xl font-semibold tracking-[-0.02em] outline-none placeholder:text-muted-foreground"
        />
        <MarkdownEditor
          label="Description"
          placeholder="Add a description."
          maxLength={20000}
          className="max-h-64 min-h-[5.5rem] overflow-y-auto"
          value={body}
          onChange={(v) => {
            setBody(v)
            setCreated(null)
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 px-4 py-3">
        <StatusPicker value={status} onChange={setStatus} />
        <PriorityPicker value={priority} onChange={setPriority} />
        {workspaceId && (
          <AssigneePicker
            workspaceId={workspaceId}
            value={assignees}
            onChange={(next) => {
              assigneeSeeded.current = true
              setAssignees(next)
            }}
          />
        )}
        <DuePicker value={dueAt} status={status} onChange={changeDue} />
        {workspaceId && <TagPicker workspaceId={workspaceId} value={tags} onChange={setTags} />}
        {tags.map((t) => (
          <TagDot key={t.id} name={t.name} color={t.color} />
        ))}
      </div>
      <div className="px-5">
        <FormError
          message={
            create.error &&
            (create.error instanceof ApiError && create.error.status < 500
              ? create.error.message
              : "Could not create the task.")
          }
        />
      </div>
      <DialogFooter className="mt-0 items-center gap-3 border-t border-border px-5 py-3">
        <label
          htmlFor={moreId}
          className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
        >
          <Checkbox
            id={moreId}
            checked={createMore}
            onChange={(e) => setCreateMore(e.target.checked)}
          />
          Create more
        </label>
        <p role="status" className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {created && `Created ${created}.`}
        </p>
        <Kbd aria-hidden>{isMac() ? "⌘↵" : "Ctrl ↵"}</Kbd>
        <Button type="submit" variant="primary" size="sm" pending={create.isPending}>
          Create task
        </Button>
      </DialogFooter>
    </form>
  )
}
