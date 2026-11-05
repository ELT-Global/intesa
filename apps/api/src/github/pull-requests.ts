import type { ExpressionBuilder } from "kysely"
import { z } from "zod"
import { type Database, type Db, inTransaction } from "../db"
import { ApiError } from "../lib/errors"
import type { Status } from "../schemas"
import { findTaskIdByKey, updateTask } from "../tasks/service"
import {
  containsCommit,
  fetchGithubPullRequest,
  fetchPullRequest,
  githubPullRequest,
  type PrRef,
  prDetails,
} from "./client"
import { applyDetails, linkPullRequest, parseLinkedKeys } from "./links"
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
  // After a merge into the production branch: tasks whose PRs were found there.
  inMain?: string[]
  // Why the production branch was not checked, when it was not.
  releaseCheck?: string
}

// The webhook the event came in on: whose tasks it may touch, which branches count, and the
// token to ask GitHub with.
export type Hook = {
  workspaceId: string
  mergeBranch: string
  productionBranch: string
  token: string | null
}

// At most this many merged PRs are checked against the production branch per delivery; the
// rest wait for the next merge into it.
const MAX_RELEASE_CHECKS = 50

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

// Records where the workspace's merged PRs are once a PR merges into the production branch
// (main): that PR is there, and every other merged PR not yet found there is looked for by its
// merge commit. Nothing is guessed: a PR whose commit GitHub cannot place stays where it was,
// and is looked for again at the next merge into the production branch.
async function trackMain(db: Db, hook: Hook, ref: PrRef) {
  const inWorkspace = (eb: ExpressionBuilder<Database, "taskPullRequests">) =>
    eb(
      "taskId",
      "in",
      eb.selectFrom("tasks").select("id").where("workspaceId", "=", hook.workspaceId),
    )
  const release = async (pr: PrRef) =>
    db
      .updateTable("taskPullRequests")
      .set({ releasedTo: hook.productionBranch })
      .where("repo", "=", pr.repo)
      .where("number", "=", pr.number)
      .where(inWorkspace)
      .returning("taskId")
      .execute()

  const released = await release(ref)
  const candidates = await db
    .selectFrom("taskPullRequests")
    .select(["repo", "number", (eb) => eb.fn.max("mergeCommitSha").as("mergeCommitSha")])
    .where(inWorkspace)
    .where("state", "=", "merged")
    .where("releasedTo", "is", null)
    .where("baseBranch", "!=", hook.productionBranch)
    .groupBy(["repo", "number"])
    .limit(MAX_RELEASE_CHECKS)
    .execute()

  let releaseCheck: string | undefined
  if (candidates.length > 0 && !hook.token) {
    releaseCheck = "Set a GitHub token on the webhook to check which PRs reached the branch"
  } else {
    for (const pr of candidates) {
      let sha = pr.mergeCommitSha
      if (!sha) {
        const fetched = await fetchPullRequest(pr, hook.token)
        if (fetched && fetched !== "missing") {
          await applyDetails(db, hook.workspaceId, pr, fetched)
          sha = fetched.mergeCommitSha
        }
      }
      if (sha && (await containsCommit(pr.repo, sha, hook.productionBranch, hook.token))) {
        released.push(...(await release(pr)))
      }
    }
  }

  const taskIds = [...new Set(released.map((r) => r.taskId))]
  const inMain =
    taskIds.length === 0
      ? []
      : (
          await db
            .selectFrom("tasks")
            .innerJoin("projects", "projects.id", "tasks.projectId")
            .select(["projects.key", "tasks.number"])
            .where("tasks.id", "in", taskIds)
            .execute()
        ).map((t) => `${t.key}-${t.number}`)
  return { inMain, ...(releaseCheck && { releaseCheck }) }
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
  const result: PullRequestResult = await inTransaction(db, async (trx) => {
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
    await applyDetails(trx, hook.workspaceId, ref, details)

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
    }
  })
  // GitHub is asked about the other PRs, so this runs after the transaction.
  const merged = action === "closed" && details.state === "merged"
  if (!result.stale && merged && details.baseBranch === hook.productionBranch) {
    Object.assign(result, await trackMain(db, hook, ref))
  }
  return result
}
