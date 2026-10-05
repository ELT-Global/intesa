import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { CardPage } from "@/components/page"
import { Button } from "@/components/ui/button"
import { Field, FormError } from "@/components/ui/field"
import { api, keys } from "@/lib/api"

export const Route = createFileRoute("/_app/new-workspace")({ component: NewWorkspacePage })

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

function NewWorkspacePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const create = useMutation({
    mutationFn: () => api.createWorkspace({ name: name.trim(), slug: slug.trim() || undefined }),
    onSuccess: async ({ workspace }) => {
      await qc.invalidateQueries({ queryKey: keys.workspaces })
      await navigate({ to: "/w/$slug/home", params: { slug: workspace.slug } })
    },
  })

  return (
    <CardPage
      title="Create a workspace."
      description="A workspace holds your projects and the people working on them."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <Field
          label="Workspace name"
          required
          maxLength={80}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label="Slug (optional)"
          placeholder={slugify(name) || "my-team"}
          hint={`Address: /w/${slug.trim() || slugify(name) || "my-team"}`}
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
        />
        <FormError message={create.error?.message} />
        <Button type="submit" variant="primary" pending={create.isPending}>
          Create workspace
        </Button>
      </form>
      <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
        Cancel
      </Link>
    </CardPage>
  )
}
