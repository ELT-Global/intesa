import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Webhook } from "lucide-react"
import { type FormEvent, useId, useState } from "react"
import { ConfirmDialog } from "@/components/members/confirm-dialog"
import { notify } from "@/components/mutation-error-notice"
import { ErrorState } from "@/components/page"
import { RowsSkeleton } from "@/components/skeleton"
import { Chip } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FormError } from "@/components/ui/field"
import { Label } from "@/components/ui/input"
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel"
import { api, type GithubWebhook, keys } from "@/lib/api"
import { githubQuery } from "@/lib/queries"

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify(`Copied ${what}`)
  } catch {
    notify("Could not copy to the clipboard.", "error")
  }
}

/** A read-only value with a copy button. */
function CopyField({ label, value, what }: { label: string; value: string; what: string }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <output
          id={id}
          className="block min-w-0 flex-1 select-all break-all rounded-lg border border-border bg-muted px-2.5 py-1.5 font-mono text-[12.5px]"
        >
          {value}
        </output>
        <Button size="sm" onClick={() => copy(value, what)}>
          <Copy />
          Copy
        </Button>
      </div>
    </div>
  )
}

/**
 * The workspace's GitHub webhook: its own URL and secret, the branch whose merges move tasks
 * to Review, and an optional token for looking PRs up. Members see it; owners change it.
 */
export function GithubWebhookPanel({
  workspaceId,
  isOwner,
}: {
  workspaceId: string
  isOwner: boolean
}) {
  const qc = useQueryClient()
  const result = useQuery(githubQuery(workspaceId))
  // Shown once, right after the webhook is created or its secret regenerated.
  const [secret, setSecret] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<"regenerate" | "delete" | null>(null)

  // The workspace list says whether there is a webhook; the move dialog reads it.
  const refreshWorkspaces = () => qc.invalidateQueries({ queryKey: keys.workspaces })
  const create = useMutation({
    mutationFn: () => api.createGithub(workspaceId),
    onSuccess: async ({ github, secret }) => {
      qc.setQueryData(keys.github(workspaceId), github)
      setSecret(secret)
      setConfirming(null)
      await refreshWorkspaces()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.deleteGithub(workspaceId),
    onSuccess: async () => {
      qc.setQueryData(keys.github(workspaceId), null)
      setSecret(null)
      setConfirming(null)
      await refreshWorkspaces()
    },
  })

  const github = result.data
  return (
    <Panel>
      <PanelHeader icon={<Webhook />} title="GitHub webhook" />
      {result.isError && <ErrorState error={result.error} onRetry={() => void result.refetch()} />}
      {result.isPending && (
        <div className="p-4">
          <RowsSkeleton rows={2} />
        </div>
      )}
      {result.isSuccess && (
        <PanelBody className="flex flex-col gap-4 text-[13px]">
          <p className="text-muted-foreground">
            GitHub tells Intesa about pull requests through this webhook. A PR that says “Fixes
            ELT-151” is linked to that task, and merging a task's PRs into the merge branch moves it
            to Review.
          </p>
          {!github ? (
            isOwner ? (
              <div className="flex flex-col gap-2">
                <FormError message={create.error?.message} />
                <div>
                  <Button
                    variant="primary"
                    size="sm"
                    pending={create.isPending}
                    onClick={() => create.mutate()}
                  >
                    Create webhook
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                No webhook yet. A workspace owner can create one.
              </p>
            )
          ) : (
            <>
              {secret && (
                <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <p className="text-sm font-medium">
                    Copy the secret into GitHub now. It won't be shown again.
                  </p>
                  <CopyField label="Secret" value={secret} what="the secret" />
                </div>
              )}
              <CopyField label="Payload URL" value={github.url} what="the payload URL" />
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>
                  In GitHub, add a webhook to the organisation or repository with this payload URL.
                </li>
                <li>
                  Choose <span className="font-medium text-foreground">application/json</span>,
                  paste the secret, and pick the{" "}
                  <span className="font-medium text-foreground">Pull requests</span> event.
                </li>
              </ol>
              <MergeBranch workspaceId={workspaceId} github={github} isOwner={isOwner} />
              <GithubToken workspaceId={workspaceId} github={github} isOwner={isOwner} />
              {isOwner && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button size="sm" variant="outline" onClick={() => setConfirming("regenerate")}>
                    Regenerate secret
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming("delete")}>
                    Delete webhook
                  </Button>
                </div>
              )}
            </>
          )}
        </PanelBody>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null)
            create.reset()
            remove.reset()
          }
        }}
        title={confirming === "delete" ? "Delete the webhook?" : "Regenerate the secret?"}
        description={
          confirming === "delete"
            ? "GitHub's deliveries will be refused and the GitHub token is removed. Pull requests already linked stay on their tasks."
            : "Deliveries signed with the old secret are refused until you paste the new one into GitHub."
        }
        confirmLabel={confirming === "delete" ? "Delete webhook" : "Regenerate"}
        pending={create.isPending || remove.isPending}
        error={(confirming === "delete" ? remove.error : create.error)?.message}
        onConfirm={() => (confirming === "delete" ? remove.mutate() : create.mutate())}
      />
    </Panel>
  )
}

function useUpdate(workspaceId: string, onSaved: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (json: { mergeBranch?: string; token?: string | null }) =>
      api.updateGithub(workspaceId, json),
    onSuccess: ({ github }) => {
      qc.setQueryData(keys.github(workspaceId), github)
      onSaved()
    },
  })
}

function MergeBranch({ workspaceId, github, isOwner }: SectionProps) {
  const [branch, setBranch] = useState(github.mergeBranch)
  const save = useUpdate(workspaceId, () => notify("Saved the merge branch"))
  if (!isOwner) {
    return (
      <p>
        Merge branch: <Chip>{github.mergeBranch}</Chip>
      </p>
    )
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ mergeBranch: branch.trim() })
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <Field
          className="flex-1"
          label="Merge branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          maxLength={255}
          hint="Merging a task's pull requests into this branch moves the task to Review."
        />
      </div>
      <FormError message={save.error?.message} />
      <div>
        <Button
          type="submit"
          size="sm"
          pending={save.isPending}
          disabled={!branch.trim() || branch.trim() === github.mergeBranch}
        >
          Save
        </Button>
      </div>
    </form>
  )
}

type SectionProps = { workspaceId: string; github: GithubWebhook; isOwner: boolean }

function GithubToken({ workspaceId, github, isOwner }: SectionProps) {
  const [token, setToken] = useState("")
  const save = useUpdate(workspaceId, () => {
    setToken("")
    notify("Saved the GitHub token")
  })
  const status = (
    <Chip
      className={
        github.tokenSet
          ? "border-transparent bg-success/10 font-medium text-success-foreground"
          : ""
      }
    >
      {github.tokenSet ? "Set" : "Not set"}
    </Chip>
  )
  if (!isOwner) return <p>GitHub token: {status}</p>
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ token: token.trim() })
      }}
      className="flex flex-col gap-2"
    >
      <Field
        label="GitHub token (optional)"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        maxLength={500}
        placeholder={github.tokenSet ? "Saved; type a new one to replace it" : ""}
        hint="A fine-grained token with read-only Pull requests access, used to look PRs up when someone links one."
      />
      <FormError message={save.error?.message} />
      <div className="flex flex-wrap items-center gap-2">
        {status}
        <Button type="submit" size="sm" pending={save.isPending} disabled={!token.trim()}>
          Save token
        </Button>
        {github.tokenSet && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => save.mutate({ token: null })}
          >
            Remove token
          </Button>
        )}
      </div>
    </form>
  )
}
