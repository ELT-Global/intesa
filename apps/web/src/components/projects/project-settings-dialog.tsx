import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Field, FormError } from "@/components/ui/field"
import { Label, Textarea } from "@/components/ui/input"
import { api, keys, type Project, type Workspace } from "@/lib/api"

export function ProjectSettingsDialog({
  workspace,
  project,
  open,
  onOpenChange,
}: {
  workspace: Workspace
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Project settings." description={`Key ${project.key} can't be changed.`}>
        <SettingsForm workspace={workspace} project={project} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function SettingsForm({
  workspace,
  project,
  onDone,
}: {
  workspace: Workspace
  project: Project
  onDone: () => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? "")
  const [confirming, setConfirming] = useState(false)

  const save = useMutation({
    mutationFn: () =>
      api.updateProject(project.id, { name: name.trim(), description: description.trim() || null }),
    onSuccess: async ({ project: updated }) => {
      qc.setQueryData(keys.project(project.id), updated)
      await qc.invalidateQueries({ queryKey: keys.projects(workspace.id) })
      onDone()
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: keys.project(project.id) })
      await qc.invalidateQueries({ queryKey: keys.projects(workspace.id) })
      onDone()
      await navigate({ to: "/w/$slug/home", params: { slug: workspace.slug } })
    },
  })

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Field
          label="Project name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-description">Description</Label>
          <Textarea
            id="settings-description"
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <FormError message={save.error?.message} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" pending={save.isPending}>
            Save
          </Button>
        </div>
      </form>

      {workspace.role === "owner" && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {confirming ? (
            <>
              <p className="text-sm">
                Delete {project.name} and all of its tasks? This can't be undone.
              </p>
              <FormError message={remove.error?.message} />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  pending={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Confirm delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setConfirming(true)}
            >
              Delete project
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
