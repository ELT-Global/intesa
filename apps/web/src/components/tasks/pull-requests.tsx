import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { workspacesQuery } from "@/lib/queries"
import { type PullRequestRef, type TaskDetail, usePullRequestLink } from "@/lib/tasks"
import { PULL_REQUEST_LABELS, PullRequestIcon } from "./properties"

function describe(pr: PullRequestRef) {
  return [
    pr.state && PULL_REQUEST_LABELS[pr.state],
    pr.author,
    pr.baseBranch && `into ${pr.baseBranch}`,
    pr.source === "auto" ? "linked from the PR" : pr.linkedBy && `linked by ${pr.linkedBy.name}`,
  ]
    .filter(Boolean)
    .join(" · ")
}

/**
 * The task's pull requests, with a field to link another. Shown where the workspace has GitHub
 * connected, or where the task still has PRs from before it was disconnected.
 */
export function PullRequestsSection({ task }: { task: TaskDetail }) {
  const github = useQuery(workspacesQuery).data?.find(
    (w) => w.id === task.project.workspaceId,
  )?.github
  const change = usePullRequestLink(task)
  const [ref, setRef] = useState("")
  if (!github && task.pullRequests.length === 0) return null

  function link(e: FormEvent) {
    e.preventDefault()
    const value = ref.trim()
    if (!value) return
    change.mutate({ link: value }, { onSuccess: () => setRef("") })
  }

  return (
    <section aria-label="Pull requests" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Pull requests</h3>
      {task.pullRequests.length === 0 && (
        <p className="text-xs text-muted-foreground">
          None yet. Writing “Fixes {task.key}” in a pull request links it here.
        </p>
      )}
      <ul>
        {task.pullRequests.map((pr) => (
          <li
            key={pr.id}
            className="flex items-center gap-2 rounded-md py-1 text-[13px] hover:bg-accent/60"
          >
            <PullRequestIcon state={pr.state} />
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              title={`${pr.repo}#${pr.number}`}
              className="flex min-w-0 flex-1 items-baseline gap-2 rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="shrink-0 font-mono text-[12.5px] text-subtle-foreground">
                #{pr.number}
              </span>
              <span className="truncate">{pr.title ?? pr.repo}</span>
            </a>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {describe(pr)}
            </span>
            <Button
              variant="ghost"
              size="xs"
              icon
              aria-label={`Unlink #${pr.number}`}
              title={
                pr.source === "auto"
                  ? `Also remove “${task.key}” from the PR, or its next edit links it again`
                  : undefined
              }
              onClick={() => change.mutate({ unlink: pr.id })}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      {github && (
        <form onSubmit={link} className="flex items-center gap-2">
          <Input
            aria-label="Pull request to link"
            placeholder="Link a PR: paste its link, or owner/repo#482"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            maxLength={300}
            className="h-7 text-[13px]"
          />
          <Button type="submit" size="sm" pending={change.isPending} disabled={!ref.trim()}>
            Link
          </Button>
        </form>
      )}
      <FormError message={change.error?.message} />
    </section>
  )
}
