import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Field, FormError } from "@/components/ui/field"
import { type TaskStatus, type TaskSummary, useCreateTask } from "@/lib/tasks"

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
      <DialogContent title="New task">
        <CreateTaskForm
          projectId={projectId}
          defaultStatus={defaultStatus}
          onDone={(task) => {
            onOpenChange(false)
            onCreated?.(task)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

// Mounted only while the dialog is open, so the form state resets on every open.
function CreateTaskForm({
  projectId,
  defaultStatus,
  onDone,
}: {
  projectId: string
  defaultStatus?: TaskStatus
  onDone: (task: TaskSummary) => void
}) {
  const [title, setTitle] = useState("")
  const create = useCreateTask(projectId)

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || create.isPending) return
    create.mutate({ title: trimmed, status: defaultStatus }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs doing?"
        maxLength={200}
        autoFocus
        autoComplete="off"
      />
      <FormError message={create.error?.message} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" pending={create.isPending}>
          Create task
        </Button>
      </div>
    </form>
  )
}
