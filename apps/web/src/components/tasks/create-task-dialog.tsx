import { useQuery } from "@tanstack/react-query"
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { Kbd } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { FormError } from "@/components/ui/field"
import { projectQuery } from "@/lib/queries"
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
      <DialogContent title="New task" className="w-[min(40rem,calc(100vw-2rem))]">
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

const isMac = () => typeof navigator !== "undefined" && /mac/i.test(navigator.platform)

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
  const [assignees, setAssignees] = useState<UserRef[]>([])
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
        dueAt,
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
      <div className="flex flex-col gap-2">
        <input
          ref={titleRef}
          aria-label="Title"
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the composer exists to type a title
          autoFocus
          className="w-full bg-transparent text-xl font-semibold tracking-[-0.02em] outline-none placeholder:text-muted-foreground"
        />
        <GrowingTextarea value={body} onChange={setBody} />
      </div>
      <div className="-mx-1 flex flex-wrap items-center gap-1 py-3">
        <StatusPicker value={status} onChange={setStatus} />
        <PriorityPicker value={priority} onChange={setPriority} />
        {workspaceId && (
          <AssigneePicker workspaceId={workspaceId} value={assignees} onChange={setAssignees} />
        )}
        <DuePicker value={dueAt} status={status} onChange={setDueAt} />
        {workspaceId && <TagPicker workspaceId={workspaceId} value={tags} onChange={setTags} />}
        {tags.map((t) => (
          <TagDot key={t.id} name={t.name} color={t.color} />
        ))}
      </div>
      <FormError message={create.error?.message} />
      <div className="-mx-5 -mb-5 flex items-center gap-3 border-t border-border px-5 py-3">
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
      </div>
    </form>
  )
}

function GrowingTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the value drives the height
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      aria-label="Description"
      placeholder="Add a description."
      rows={3}
      value={value}
      maxLength={20000}
      onChange={(e) => onChange(e.target.value)}
      className="max-h-64 w-full resize-none bg-transparent text-[15px] leading-[1.7] outline-none placeholder:text-muted-foreground"
    />
  )
}
