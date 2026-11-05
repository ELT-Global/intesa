import { z } from "zod"
import { type Db, inTransaction } from "../db"
import { ApiError } from "../lib/errors"
import type { Status } from "../schemas"
import { findTaskIdByKey, updateTask } from "../tasks/service"
import {
  containsCommit,
  fetchGithubPullRequest,
  fetchPullRequest,
  githubPullRequest,
  mergedHead,
  type PrRef,
  prDetails,
} from "./client"
import { applyDetails, inWorkspace, linkPullRequest, parseLinkedKeys, releaseMerged } from "./links"
import { GITHUB_USER_ID } from "./settings"

const pullRequestEvent = z.object({
  action: z.string(),
  repository: z.object({ full_name: z.string() }),
  pull_request: githubPullRequest,
})

// Shown in GitHub's list of recent deliveries, which is where to look when a task did or did
// not move.
export type PullRequestResult = {
  linked: string[]
  unlinked: string[]
  moved: { task: string; to: Status }[]
  ignoredKeys: string[]
  // The event is older than what is stored, so it changed nothing.
  stale?: true
  // After a merge into the production branch: its tasks, now in it.
  inMain?: string[]
}

// The webhook the event came in on: whose tasks it may touch, which branches count, and the
// token to ask GitHub with.
export type Hook = {
  workspaceId: string
  mergeBranch: string
  productionBranch: string
  token: string | null
}

const pushEvent = z.object({
  ref: z.string(),
  // The commit the branch now points at.
  after: z.string().optional(),
  deleted: z.boolean().optional(),
  repository: z.object({ full_name: z.string() }),
})

// After a push into the production branch.
export type ReleaseResult = {
  // Tasks whose PRs were found there by this delivery.
  inMain: string[]
  // Why some or all of the merged PRs could not be checked, when that happened.
  releaseCheck?: string
}

// At most this many merged PRs are checked against the production branch per delivery, newest
// first; the rest wait for the next push into it.
const MAX_RELEASE_CHECKS = 50

// GitHub is asked about this many of them at once, few enough to stay clear of its limits on
// concurrent requests.
const RELEASE_CHECK_BATCH = 10

// GitHub waits 10 seconds for a delivery's reply; whatever is not checked by then waits for the
// next push.
const RELEASE_CHECK_MS = 8000

// Anyone who can open a PR on a repository that sends to the webhook can name keys in it, so
// only this many are looked up; the rest are reported as ignored.
const MAX_LINKED_KEYS = 10

// The newest event applied for a PR. Unlike the links' details, it outlives the links.
const lastApplied = async (db: Db, workspaceId: string, ref: PrRef) =>
  (
    await db
      .selectFrom("githubPullRequests")
      .select("githubUpdatedAt")
      .where("workspaceId", "=", workspaceId)
      .where("repo", "=", ref.repo)
      .where("number", "=", ref.number)
      .executeTakeFirst()
  )?.githubUpdatedAt

// A task is ready for review once none of its PRs is still open and at least one has been
// merged into the merge branch. PRs closed without merging, merged elsewhere (say into a
// stacked PR's branch), or that GitHub could never be asked about count neither way.
async function readyForReview(trx: Db, taskId: string, mergeBranch: string) {
  const prs = await trx
    .selectFrom("taskPullRequests")
    .select(["state", "baseBranch"])
    .where("taskId", "=", taskId)
    .execute()
  const pending = prs.some((p) => p.state === "open" || p.state === "draft")
  const landed = prs.some((p) => p.state === "merged" && p.baseBranch === mergeBranch)
  return !pending && landed
}

// A PR linked by hand while GitHub could not be asked has no state, and no event may ever fill
// it in (it was already merged, or its repository does not send to the webhook). Before a
// closed PR decides whether its tasks are ready for review, GitHub is asked once more about
// the other PRs on those tasks that are still unknown.
async function refreshUnknown(db: Db, hook: Hook, ref: PrRef, named: string[]) {
  const linkedTo = await db
    .selectFrom("taskPullRequests")
    .innerJoin("tasks", "tasks.id", "taskPullRequests.taskId")
    .select("taskPullRequests.taskId")
    .where("taskPullRequests.repo", "=", ref.repo)
    .where("taskPullRequests.number", "=", ref.number)
    .where("tasks.workspaceId", "=", hook.workspaceId)
    .execute()
  const taskIds = [...new Set([...linkedTo.map((l) => l.taskId), ...named])]
  if (taskIds.length === 0) return
  const unknown = await db
    .selectFrom("taskPullRequests")
    .select(["repo", "number"])
    .distinct()
    .where("taskId", "in", taskIds)
    .where("state", "is", null)
    .execute()
  await Promise.all(
    unknown
      .filter((pr) => pr.repo !== ref.repo || pr.number !== ref.number)
      .map(async (pr) => {
        const details = await fetchPullRequest(pr, hook.token)
        if (details && details !== "missing") {
          await applyDetails(db, hook.workspaceId, pr, details)
        }
      }),
  )
}

// Records where the workspace's merged PRs in a repository are once its production branch
// (main) moves to commit `after`: PRs merged into the branch itself are there, and every other
// merged PR not yet found there is looked for by its merge commit. When a PR's merge made
// `after`, they are looked for in that PR's head instead, which holds them even when the merge
// was a squash or a rebase. Nothing is guessed: a PR whose commit GitHub cannot place stays
// where it was, is named in the reply, and is looked for again at the next push. A PR once
// found stays released, even if a force push later takes its commit out again. Every write only
// fills in a releasedTo that is still empty, so deliveries that race or repeat each other report
// each task once.
async function trackRelease(
  db: Db,
  hook: Hook,
  repo: string,
  after: string | undefined,
): Promise<ReleaseResult> {
  const released = await releaseMerged(db, hook.workspaceId, repo)
  // Newest first, so PRs that will never be found (reverted, merged into an abandoned branch)
  // cannot crowd out the ones merged since.
  const candidates = await db
    .selectFrom("taskPullRequests")
    .select(["repo", "number", (eb) => eb.fn.max("mergeCommitSha").as("mergeCommitSha")])
    .where("repo", "=", repo)
    .where(inWorkspace(hook.workspaceId))
    .where("state", "=", "merged")
    .where("releasedTo", "is", null)
    .where("baseBranch", "!=", hook.productionBranch)
    .groupBy(["repo", "number"])
    .orderBy((eb) => eb.fn.max("githubUpdatedAt"), "desc")
    .orderBy("number", "desc")
    .limit(MAX_RELEASE_CHECKS)
    .execute()

  const problems: string[] = []
  if (candidates.length > 0 && !hook.token) {
    // Without one GitHub allows 60 requests an hour, fewer than a single push may need.
    problems.push("Set a GitHub token on the webhook to check which PRs reached the branch")
  } else if (candidates.length > 0) {
    const deadline = AbortSignal.timeout(RELEASE_CHECK_MS)
    const target =
      (after && (await mergedHead(repo, after, hook.token, deadline))) ??
      after ??
      hook.productionBranch
    const release = (pr: PrRef) =>
      db
        .updateTable("taskPullRequests")
        .set({ releasedTo: hook.productionBranch })
        .where("repo", "=", pr.repo)
        .where("number", "=", pr.number)
        .where("releasedTo", "is", null)
        .where(inWorkspace(hook.workspaceId))
        .returning("taskId")
        .execute()
    const unplaced: number[] = []
    const late: number[] = []
    const check = async (pr: (typeof candidates)[number]) => {
      let sha = pr.mergeCommitSha
      if (!sha && !deadline.aborted) {
        const fetched = await fetchPullRequest(pr, hook.token, deadline)
        if (fetched && fetched !== "missing") {
          await applyDetails(db, hook.workspaceId, pr, fetched)
          sha = fetched.mergeCommitSha
        }
      }
      const found =
        sha && !deadline.aborted
          ? await containsCommit(pr.repo, sha, target, hook.token, deadline)
          : undefined
      if (found === undefined) (deadline.aborted ? late : unplaced).push(pr.number)
      else if (found) released.push(...(await release(pr)))
    }
    for (let i = 0; i < candidates.length; i += RELEASE_CHECK_BATCH) {
      await Promise.all(candidates.slice(i, i + RELEASE_CHECK_BATCH).map(check))
    }
    const list = (numbers: number[]) =>
      numbers
        .sort((a, b) => a - b)
        .map((n) => `#${n}`)
        .join(", ")
    if (unplaced.length > 0) {
      problems.push(
        `GitHub could not say whether ${repo} ${list(unplaced)} reached ${hook.productionBranch}; ` +
          "check the branch exists and the GitHub token can read the repository's contents",
      )
    }
    if (late.length > 0) {
      problems.push(
        `GitHub was too slow to check ${repo} ${list(late)} in time; ` +
          `they are checked again at the next push to ${hook.productionBranch}`,
      )
    }
  }

  const inMain = await taskKeys(
    db,
    released.map((r) => r.taskId),
  )
  return { inMain, ...(problems.length > 0 && { releaseCheck: problems.join(". ") }) }
}

// "WEB-12" for each of the tasks, without duplicates.
async function taskKeys(db: Db, taskIds: string[]) {
  if (taskIds.length === 0) return []
  const tasks = await db
    .selectFrom("tasks")
    .innerJoin("projects", "projects.id", "tasks.projectId")
    .select(["projects.key", "tasks.number"])
    .where("tasks.id", "in", [...new Set(taskIds)])
    .execute()
  return tasks.map((t) => `${t.key}-${t.number}`)
}

// Links and unlinks the workspace's tasks named by keywords in the PR (except those someone
// unlinked it from), stores the PR's state, and makes the only two automatic status changes
// there are:
// - a PR that is open (or draft) and newly links a task in Backlog or Todo starts it;
// - when a PR closes, a task In progress whose PRs are all done goes to Review.
// A task anywhere else is left where someone put it.
export async function onPullRequest(
  db: Db,
  hook: Hook,
  payload: unknown,
): Promise<PullRequestResult> {
  const parsed = pullRequestEvent.safeParse(payload)
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Not a pull_request event payload")
  const { action, repository } = parsed.data
  let pr = parsed.data.pull_request
  const ref = { repo: repository.full_name.toLowerCase(), number: pr.number }
  // GitHub's updated_at is to the second, so it cannot order two events from the same second;
  // GitHub is asked what the PR is now instead. If it cannot be asked, the event is taken as is.
  if ((await lastApplied(db, hook.workspaceId, ref)) === pr.updated_at) {
    const current = await fetchGithubPullRequest(ref, hook.token)
    if (current && current !== "missing" && current.number === pr.number) pr = current
  }
  const details = prDetails(pr)

  const named = new Map<string, string>()
  const keys = parseLinkedKeys(`${pr.title}\n${pr.body ?? ""}`)
  const ignoredKeys = keys.slice(MAX_LINKED_KEYS)
  for (const key of keys.slice(0, MAX_LINKED_KEYS)) {
    const taskId = await findTaskIdByKey(db, hook.workspaceId, key)
    if (taskId) named.set(taskId, key)
    else ignoredKeys.push(key)
  }
  if (action === "closed") await refreshUnknown(db, hook, ref, [...named.keys()])
  return inTransaction(db, async (trx): Promise<PullRequestResult> => {
    const links = (
      await trx
        .selectFrom("taskPullRequests")
        .innerJoin("tasks", "tasks.id", "taskPullRequests.taskId")
        .innerJoin("projects", "projects.id", "tasks.projectId")
        .select([
          "taskPullRequests.id",
          "taskPullRequests.taskId",
          "taskPullRequests.source",
          "taskPullRequests.githubUpdatedAt",
          "projects.key as projectKey",
          "tasks.number",
        ])
        .where("taskPullRequests.repo", "=", ref.repo)
        .where("taskPullRequests.number", "=", ref.number)
        .where("tasks.workspaceId", "=", hook.workspaceId)
        .execute()
    ).map((l) => ({ ...l, key: `${l.projectKey}-${l.number}` }))

    // A late or redelivered event must not undo the links a newer one made, nor move tasks on
    // what the PR used to be.
    const applied = await lastApplied(trx, hook.workspaceId, ref)
    if (
      (applied !== undefined && applied > details.githubUpdatedAt) ||
      links.some((l) => l.githubUpdatedAt !== null && l.githubUpdatedAt > details.githubUpdatedAt)
    ) {
      return { linked: [], unlinked: [], moved: [], ignoredKeys, stale: true as const }
    }
    await trx
      .insertInto("githubPullRequests")
      .values({ workspaceId: hook.workspaceId, ...ref, githubUpdatedAt: details.githubUpdatedAt })
      .onConflict((oc) =>
        oc
          .columns(["workspaceId", "repo", "number"])
          .doUpdateSet({ githubUpdatedAt: details.githubUpdatedAt }),
      )
      .execute()

    // Automatic links follow the PR's text; links made by hand are never removed here.
    const unlinked = links.filter((l) => l.source === "auto" && !named.has(l.taskId))
    if (unlinked.length > 0) {
      await trx
        .deleteFrom("taskPullRequests")
        .where(
          "id",
          "in",
          unlinked.map((l) => l.id),
        )
        .execute()
    }
    const unlinkedByHand = new Set(
      named.size === 0
        ? []
        : (
            await trx
              .selectFrom("taskPullRequestUnlinks")
              .select("taskId")
              .where("repo", "=", ref.repo)
              .where("number", "=", ref.number)
              .where("taskId", "in", [...named.keys()])
              .execute()
          ).map((u) => u.taskId),
    )
    const linked: string[] = []
    for (const taskId of named.keys()) {
      if (unlinkedByHand.has(taskId)) continue
      const task = { id: taskId, workspaceId: hook.workspaceId }
      const isNew = await linkPullRequest(trx, task, { ...ref, details: undefined }, "auto", null)
      if (isNew) linked.push(taskId)
    }
    const released = await applyDetails(trx, hook.workspaceId, ref, details)

    const keys = new Map([...links.map((l) => [l.taskId, l.key] as const), ...named])
    const moved: { task: string; to: Status }[] = []
    const move = async (taskId: string, from: Status[], to: Status) => {
      const task = await trx
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", taskId)
        .executeTakeFirstOrThrow()
      if (!from.includes(task.status as Status)) return
      if (to === "review" && !(await readyForReview(trx, taskId, hook.mergeBranch))) return
      await updateTask(trx, GITHUB_USER_ID, task, { status: to })
      moved.push({ task: keys.get(taskId) ?? taskId, to })
    }

    if (details.state === "open" || details.state === "draft") {
      for (const taskId of linked) await move(taskId, ["backlog", "todo"], "in_progress")
    }
    if (action === "closed") {
      const stillLinked = new Set([
        ...links.filter((l) => !unlinked.includes(l)).map((l) => l.taskId),
        ...linked,
      ])
      for (const taskId of stillLinked) await move(taskId, ["in_progress"], "review")
    }

    return {
      linked: linked.map((id) => keys.get(id) ?? id),
      unlinked: unlinked.map((l) => l.key),
      moved,
      ignoredKeys,
      ...(released.length > 0 && {
        inMain: [...new Set(released.map((r) => keys.get(r.taskId) ?? r.taskId))],
      }),
    }
  })
}

// Every change to the production branch is a push, a PR merging into it included, so this is
// where the merged PRs are looked for there; the pull_request delivery of a merge into it only
// marks that PR's own tasks. Pushes to any other branch or tag, and the branch being deleted,
// change nothing and ask GitHub nothing.
export async function onPush(
  db: Db,
  hook: Hook,
  payload: unknown,
): Promise<ReleaseResult | { ignored: string }> {
  const parsed = pushEvent.safeParse(payload)
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Not a push event payload")
  const { ref, deleted, repository } = parsed.data
  if (ref !== `refs/heads/${hook.productionBranch}`) {
    return { ignored: `Not the production branch (${hook.productionBranch})` }
  }
  if (deleted) return { ignored: "The branch was deleted" }
  return trackRelease(db, hook, repository.full_name.toLowerCase(), parsed.data.after)
}
