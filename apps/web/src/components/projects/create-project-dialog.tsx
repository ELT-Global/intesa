import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Field, FormError } from "@/components/ui/field"
import { Label, Textarea } from "@/components/ui/input"
import { api, keys, type Workspace } from "@/lib/api"

/** Mirrors the server's derivation closely enough to preview; the server has the final say. */
export function previewKey(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? []
  const letters = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "")
  const key = letters.slice(0, 5)
  return /^[A-Z]/.test(key) && key.length >= 2 ? key : ""
}

export function CreateProjectDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create project." description="Projects group tasks under one key.">
        <CreateForm workspace={workspace} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function CreateForm({ workspace, onDone }: { workspace: Workspace; onDone: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [key, setKey] = useState("")
  const [description, setDescription] = useState("")
  const shownKey = key.trim() || previewKey(name)

  const create = useMutation({
    mutationFn: () =>
      api.createProject(workspace.id, {
        name: name.trim(),
        key: key.trim() || undefined,
        description: description.trim() || undefined,
      }),
    onSuccess: async ({ project }) => {
      await qc.invalidateQueries({ queryKey: keys.projects(workspace.id) })
      onDone()
      await navigate({
        to: "/w/$slug/projects/$projectId/board",
        params: { slug: workspace.slug, projectId: project.id },
      })
    },
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <Field
        label="Project name"
        required
        maxLength={80}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        label="Key (optional)"
        maxLength={5}
        placeholder={previewKey(name) || "WEB"}
        inputClassName="font-mono uppercase"
        hint={
          shownKey
            ? `Tasks are numbered ${shownKey}-1, ${shownKey}-2.`
            : "2 to 5 letters or digits."
        }
        value={key}
        onChange={(e) => setKey(e.target.value.toUpperCase())}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-description">Description (optional)</Label>
        <Textarea
          id="project-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <FormError message={create.error?.message} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" pending={create.isPending}>
          Create project
        </Button>
      </div>
    </form>
  )
}
