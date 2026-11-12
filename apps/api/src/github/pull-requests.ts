import { z } from "zod"
import { type Db, inTransaction } from "../db"
import { ApiError } from "../lib/errors"
import type { Status } from "../schemas"
import { findTaskIdByKey, updateTask } from "../tasks/service"
import {
  fetchGithubPullRequest,
  fetchPullRequest,
  githubPullRequest,
  MAX_PR_COMMITS,
  type PrRef,
  prDetails,
} from "./client"
import { applyDetails, inWorkspace, linkPullRequest, parseLinkedKeys, releaseMerged } from "./links"
import {
  RELEASE_CHECK_MS,
  recordProductionCommits,
  releaseByFingerprint,
  releaseIfArrived,
  rememberCommits,
} from "./releases"
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
  deleted: z.boolean().optional(),
  repository: z.object({ full_name: z.string() }),
  // Every commit new to the branch (GitHub lists up to 2048), whether or not it was pushed to
  // another branch before.
  commits: z
    .array(
      z.object({
        message: z.string(),
        author: z.object({ email: z.string().nullish(), date: z.string().nullish() }).nullish(),
      }),
    )
    .default([]),
})

// After a push into the production branch.
export type ReleaseResult = {
  // Tasks whose PRs were found there by this delivery.
  inMain: string[]
  // Why some or all of the merged PRs could not be checked, when that happened.
  releaseCheck?: string
}

// A merged PR's commits are asked for when it merges. For PRs whose commits are not kept yet (the
// request failed, or the PR was linked by hand), a push into the production branch asks for at
// most this many, newest first; the rest wait for the next push into it.
const MAX_RELEASE_CHECKS = 50

// GitHub is asked about this many of them at once, few enough to stay clear of its limits on
// concurrent requests.
const RELEASE_CHECK_BATCH = 10

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

// Records where the workspace's merged PRs in a repository are once a push brings `commits`
// into its production branch (main): PRs merged into the branch itself are there, and every
// other merged PR is there once all its commits have arrived, recognised by fingerprint (see
// github/releases.ts) so that rebasing on the way does not hide them. The PRs whose commits are
// not kept yet are asked for first. Nothing is guessed: a PR whose commits GitHub cannot list
// stays where it was, is named in the reply, and is asked for again at the next push. A PR once
// found stays released, even if a force push later takes its commits out again. Every write
// only fills in a releasedTo that is still empty, so deliveries that race or repeat each other
// report each task once.
async function trackRelease(
  db: Db,
  hook: Hook,
  repo: string,
  commits: z.infer<typeof pushEvent>["commits"],
): Promise<ReleaseResult> {
  await recordProductionCommits(db, hook.workspaceId, repo, commits)
  const released = await releaseMerged(db, hook.workspaceId, repo)
  // Newest first, so PRs whose commits GitHub will never list cannot crowd out the ones merged
  // since.
  const unknown = await db
    .selectFrom("taskPullRequests")
    .select(["repo", "number", (eb) => eb.fn.max("mergeCommitSha").as("mergeCommitSha")])
    .where("repo", "=", repo)
    .where(inWorkspace(hook.workspaceId))
    .where("state", "=", "merged")
    .where("releasedTo", "is", null)
    .where("baseBranch", "!=", hook.productionBranch)
    .where(({ exists, not, selectFrom }) =>
      not(
        exists(
          selectFrom("pullRequestCommits as c")
            .select("c.fingerprint")
            .where("c.workspaceId", "=", hook.workspaceId)
            .whereRef("c.repo", "=", "taskPullRequests.repo")
            .whereRef("c.number", "=", "taskPullRequests.number")
            .where("c.squash", "=", 0),
        ),
      ),
    )
    .groupBy(["repo", "number"])
    .orderBy((eb) => eb.fn.max("githubUpdatedAt"), "desc")
    .orderBy("number", "desc")
    .limit(MAX_RELEASE_CHECKS)
    .execute()

  const problems: string[] = []
  if (unknown.length > 0 && !hook.token) {
    // Without one GitHub allows 60 requests an hour, fewer than a single push may need.
    problems.push("Set a GitHub token on the webhook to check which PRs reached the branch")
  } else if (unknown.length > 0) {
    const deadline = AbortSignal.timeout(RELEASE_CHECK_MS)
    const unlisted: number[] = []
    const tooMany: number[] = []
    const late: number[] = []
    const ask = async (pr: (typeof unknown)[number]) => {
      // Its merge commit tells a squash merge apart.
      if (!pr.mergeCommitSha && !deadline.aborted) {
        const fetched = await fetchPullRequest(pr, hook.token, deadline)
        if (fetched && fetched !== "missing") await applyDetails(db, hook.workspaceId, pr, fetched)
      }
      const result = deadline.aborted
        ? "failed"
        : await rememberCommits(db, hook.workspaceId, pr, hook.token, deadline)
      if (result === "too-many") tooMany.push(pr.number)
      else if (result === "failed") (deadline.aborted ? late : unlisted).push(pr.number)
    }
    for (let i = 0; i < unknown.length; i += RELEASE_CHECK_BATCH) {
      await Promise.all(unknown.slice(i, i + RELEASE_CHECK_BATCH).map(ask))
    }
    const list = (numbers: number[]) =>
      numbers
        .sort((a, b) => a - b)
        .map((n) => `#${n}`)
        .join(", ")
    if (unlisted.length > 0) {
      problems.push(
        `GitHub could not list the commits of ${repo} ${list(unlisted)}; ` +
          `they are asked for again at the next push to ${hook.productionBranch}`,
      )
    }
    if (tooMany.length > 0) {
      const one = tooMany.length === 1
      problems.push(
        `${repo} ${list(tooMany)} ha${one ? "s" : "ve"} more commits than GitHub lists ` +
          `(${MAX_PR_COMMITS}); mark ${one ? "its" : "their"} tasks as in ${hook.productionBranch} by hand`,
      )
    }
    if (late.length > 0) {
      problems.push(
        `GitHub was too slow to list the commits of ${repo} ${list(late)} in time; ` +
          `they are asked for again at the next push to ${hook.productionBranch}`,
      )
    }
  }
  released.push(...(await releaseByFingerprint(db, hook.workspaceId, hook.productionBranch, repo)))

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
  const result = await inTransaction(db, async (trx): Promise<PullRequestResult> => {
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

  // A merge anywhere but the production branch: its commits are kept now, while GitHub still
  // has them at hand, so the pushes that later bring them into the production branch need not
  // ask. Those that arrived there before it merged (a fix cherry-picked onto main first, say)
  // mark it at once.
  if (
    action === "closed" &&
    details.state === "merged" &&
    details.baseBranch !== hook.productionBranch &&
    !result.stale &&
    (await isLinked(db, hook.workspaceId, ref))
  ) {
    const released = await releaseIfArrived(
      db,
      hook.workspaceId,
      ref,
      AbortSignal.timeout(RELEASE_CHECK_MS),
    )
    const inMain = await taskKeys(
      db,
      released.map((r) => r.taskId),
    )
    if (inMain.length > 0) result.inMain = [...new Set([...(result.inMain ?? []), ...inMain])]
  }
  return result
}

const isLinked = async (db: Db, workspaceId: string, ref: PrRef) =>
  (await db
    .selectFrom("taskPullRequests")
    .select("id")
    .where("repo", "=", ref.repo)
    .where("number", "=", ref.number)
    .where(inWorkspace(workspaceId))
    .executeTakeFirst()) !== undefined

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
  return trackRelease(db, hook, repository.full_name.toLowerCase(), parsed.data.commits)
}
