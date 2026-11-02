import { type Db, newId, now } from "../db"
import { ApiError } from "../lib/errors"
import { TASK_KEY_PATTERN } from "../schemas"
import { fetchPullRequest, type PrDetails, type PrRef, parsePrRef, prUrl } from "./client"
import { workspaceWebhook } from "./settings"

// TASK_KEY_PATTERN without its anchors, so a key is found anywhere in the text.
const KEY = String.raw`${TASK_KEY_PATTERN.source.replace(/^\^|\$$/g, "")}\b`
// A keyword, like GitHub's "fixes #12", followed by one or more task keys: "Fixes ELT-151",
// "links: ELT-3, ELT-4 and ELT-5". A key mentioned without a keyword links nothing.
const LINKING = new RegExp(
  String.raw`\b(?:link(?:s|ed)?|fix(?:es|ed)?|close[sd]?|resolve[sd]?)\b:?\s+(${KEY}(?:\s*(?:,|\band\b)?\s*${KEY})*)`,
  "gi",
)

// The task keys a PR's title and description link to, upper-cased and without duplicates.
export function parseLinkedKeys(text: string): string[] {
  const keys = new Set<string>()
  for (const [, list] of text.matchAll(LINKING)) {
    for (const [key] of (list as string).matchAll(new RegExp(KEY, "gi"))) {
      keys.add(key.toUpperCase())
    }
  }
  return [...keys]
}

export type ResolvedPr = PrRef & { details: PrDetails | undefined }

// Turns what someone typed into a PR, asking GitHub for its details with the workspace's token.
// A PR GitHub says does not exist is refused; one it could not be asked about is still linked.
export async function resolvePullRequest(
  db: Db,
  workspaceId: string,
  input: string,
): Promise<ResolvedPr> {
  const ref = parsePrRef(input)
  const details = await fetchPullRequest(ref, (await workspaceWebhook(db, workspaceId))?.token)
  if (details === "missing") {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Pull request ${ref.repo}#${ref.number} was not found, or the GitHub token cannot see it`,
    )
  }
  return { ...ref, details }
}

// Links a PR to a task, or refreshes the link. A manual link stays manual, and linking by hand
// turns an automatic link into a manual one, so later edits to the PR never remove it, and
// undoes an earlier unlink. Returns whether the link is new. Two links of the same PR at once
// (a webhook racing the Link button, or GitHub's "opened" and "edited") both succeed, and only
// one of them is new.
export async function linkPullRequest(
  trx: Db,
  task: { id: string; workspaceId: string },
  pr: ResolvedPr,
  source: "manual" | "auto",
  linkedBy: string | null,
): Promise<boolean> {
  const ts = now()
  const inserted = await trx
    .insertInto("taskPullRequests")
    .values({
      id: newId(),
      taskId: task.id,
      repo: pr.repo,
      number: pr.number,
      url: prUrl(pr),
      title: null,
      author: null,
      state: null,
      baseBranch: null,
      githubUpdatedAt: null,
      source,
      linkedBy,
      createdAt: ts,
      updatedAt: ts,
    })
    .onConflict((oc) => oc.columns(["taskId", "repo", "number"]).doNothing())
    .returning("id")
    .executeTakeFirst()
  if (source === "manual") {
    await trx
      .deleteFrom("taskPullRequestUnlinks")
      .where("taskId", "=", task.id)
      .where("repo", "=", pr.repo)
      .where("number", "=", pr.number)
      .execute()
  }
  if (!inserted && source === "manual") {
    await trx
      .updateTable("taskPullRequests")
      .set({ source, linkedBy, updatedAt: ts })
      .where("taskId", "=", task.id)
      .where("repo", "=", pr.repo)
      .where("number", "=", pr.number)
      .where("source", "=", "auto")
      .execute()
  }
  if (pr.details) await applyDetails(trx, task.workspaceId, pr, pr.details)
  return inserted !== undefined
}

// Unlinks one of a task's PRs, and remembers it, so keywords in the PR do not link it again
// (linking it by hand does). Unlinking never changes the task's status.
export async function unlinkPullRequest(trx: Db, taskId: string, pullRequestId: string) {
  const removed = await trx
    .deleteFrom("taskPullRequests")
    .where("taskId", "=", taskId)
    .where("id", "=", pullRequestId)
    .returning(["repo", "number"])
    .executeTakeFirst()
  if (!removed) throw new ApiError("NOT_FOUND", "Pull request not found on this task")
  await trx
    .insertInto("taskPullRequestUnlinks")
    .values({ taskId, repo: removed.repo, number: removed.number, createdAt: now() })
    .onConflict((oc) => oc.columns(["taskId", "repo", "number"]).doNothing())
    .execute()
}

// Copies GitHub's view of a PR onto every task in the workspace it is linked to, unless what is
// stored is already newer (events can arrive late, twice or out of order). Only the workspace's
// own rows: its webhook's secret says nothing about anyone else's tasks.
export async function applyDetails(trx: Db, workspaceId: string, ref: PrRef, details: PrDetails) {
  await trx
    .updateTable("taskPullRequests")
    .set({ ...details, updatedAt: now() })
    .where("repo", "=", ref.repo)
    .where("number", "=", ref.number)
    .where("taskId", "in", (eb) =>
      eb.selectFrom("tasks").select("id").where("workspaceId", "=", workspaceId),
    )
    .where((eb) =>
      eb.or([
        eb("githubUpdatedAt", "is", null),
        eb("githubUpdatedAt", "<=", details.githubUpdatedAt),
      ]),
    )
    .execute()
}
