import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { CardPage } from "@/components/page"
import { Button, buttonClass } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
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
  const err = () => create.error?.message
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
          error={create.error && !/slug/i.test(err() ?? "") ? err() : null}
          required
          maxLength={80}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label="Slug (optional)"
          error={create.error && /slug/i.test(err() ?? "") ? err() : null}
          placeholder={slugify(name) || "my-team"}
          hint={`Address: /w/${slug.trim() || slugify(name) || "my-team"}`}
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
        />
        <Button type="submit" variant="primary" pending={create.isPending}>
          Create workspace
        </Button>
      </form>
      <Link to="/" className={buttonClass("link", "xs")}>
        Cancel
      </Link>
    </CardPage>
  )
}
