import { type Db, now } from "../db"
import { ApiError } from "../lib/errors"
import { commitDetails, type PrRef, pullRequestCommits } from "./client"
import { type CommitIdentity, commitFingerprint } from "./fingerprint"
import { inWorkspace } from "./links"
import { DEFAULT_PRODUCTION_BRANCH, workspaceWebhook } from "./settings"

// Where a task's code is, followed through rebases. Rebasing (GitHub's "Rebase and merge", or
// rebasing qa onto main and force-pushing it) gives commits new ids but keeps their
// fingerprints (github/fingerprint.ts). So each merged PR's commits are kept by fingerprint, so
// is every commit seen arriving in the production branch, and a PR is in that branch once all
// its commits are, whatever their ids by then and however many pushes brought them. Squashing,
// rewording or `--reset-author-date` make a different commit, which is not recognised; such a
// PR can be marked as in the branch by hand.

// Rows per insert, well under SQLite's and Postgres's limits on parameters per statement.
const INSERT_CHUNK = 500

// GitHub waits 10 seconds for a delivery's reply; whatever is not asked by then waits for the
// next push. Linking a PR by hand waits no longer either.
export const RELEASE_CHECK_MS = 8000

export type RememberResult = "stored" | "too-many" | "failed"

// Asks GitHub for a merged PR's commits and keeps their fingerprints. When the merge made a
// commit of its own in the base branch that is none of the PR's commits and not a merge commit,
// it was a squash; that commit is kept too, and stands for all of them. Anything GitHub cannot
// answer is "failed", and asked again at the next push to the production branch.
export async function rememberCommits(
  db: Db,
  workspaceId: string,
  ref: PrRef,
  token: string | null,
  signal?: AbortSignal,
): Promise<RememberResult> {
  const own = await pullRequestCommits(ref, token, signal)
  if (own === "too-many") return "too-many"
  if (!own || own.length === 0) return "failed"
  const merged = await db
    .selectFrom("taskPullRequests")
    .select((eb) => eb.fn.max("mergeCommitSha").as("sha"))
    .where("repo", "=", ref.repo)
    .where("number", "=", ref.number)
    .where(inWorkspace(workspaceId))
    .executeTakeFirst()
  let squash: string | undefined
  if (merged?.sha) {
    const landed = await commitDetails(ref.repo, merged.sha, token, signal)
    if (!landed) return "failed"
    if (!landed.merge && !own.includes(landed.fingerprint)) squash = landed.fingerprint
  }
  const rows = [
    ...[...new Set(own)].map((fingerprint) => ({ fingerprint, squash: 0 })),
    ...(squash ? [{ fingerprint: squash, squash: 1 }] : []),
  ].map((r) => ({ workspaceId, repo: ref.repo, number: ref.number, ...r }))
  await db
    .insertInto("pullRequestCommits")
    .values(rows)
    .onConflict((oc) => oc.columns(["workspaceId", "repo", "number", "fingerprint"]).doNothing())
    .execute()
  return "stored"
}

// Keeps the fingerprints of the commits a push brought into the production branch.
export async function recordProductionCommits(
  db: Db,
  workspaceId: string,
  repo: string,
  commits: CommitIdentity[],
) {
  const fingerprints = [...new Set(commits.map(commitFingerprint).filter((f) => f !== undefined))]
  const ts = now()
  for (let i = 0; i < fingerprints.length; i += INSERT_CHUNK) {
    await db
      .insertInto("productionCommits")
      .values(
        fingerprints
          .slice(i, i + INSERT_CHUNK)
          .map((fingerprint) => ({ workspaceId, repo, fingerprint, createdAt: ts })),
      )
      .onConflict((oc) => oc.columns(["workspaceId", "repo", "fingerprint"]).doNothing())
      .execute()
  }
}

// Marks the workspace's links of merged PRs in a repository (or of one PR) as in the production
// branch once all the PR's commits, or its squash commit, have arrived there. Only fills in an
// empty releasedTo, so deliveries that race or repeat each other report each task once, and a
// mark made by hand is kept. Returns the tasks marked.
export const releaseByFingerprint = (
  db: Db,
  workspaceId: string,
  productionBranch: string,
  repo: string,
  number?: number,
) =>
  db
    .updateTable("taskPullRequests")
    .set({ releasedTo: productionBranch })
    .where("repo", "=", repo)
    .$if(number !== undefined, (qb) => qb.where("number", "=", number as number))
    .where("state", "=", "merged")
    .where("releasedTo", "is", null)
    .where(inWorkspace(workspaceId))
    .where((eb) => {
      // The PR's kept commits of one kind (its own, or its squash commit), and of those, the
      // ones that have arrived in the production branch or not.
      const commits = (squash: number) =>
        eb
          .selectFrom("pullRequestCommits as c")
          .select("c.fingerprint")
          .where("c.workspaceId", "=", workspaceId)
          .whereRef("c.repo", "=", "taskPullRequests.repo")
          .whereRef("c.number", "=", "taskPullRequests.number")
          .where("c.squash", "=", squash)
      const arrived = (squash: number, yes: boolean) =>
        commits(squash).where((ceb) => {
          const there = ceb.exists(
            ceb
              .selectFrom("productionCommits as p")
              .select("p.fingerprint")
              .where("p.workspaceId", "=", workspaceId)
              .whereRef("p.repo", "=", "c.repo")
              .whereRef("p.fingerprint", "=", "c.fingerprint"),
          )
          return yes ? there : ceb.not(there)
        })
      return eb.or([
        eb.and([eb.exists(commits(0)), eb.not(eb.exists(arrived(0, false)))]),
        eb.exists(arrived(1, true)),
      ])
    })
    .returning("taskId")
    .execute()

// Asks GitHub for a PR's commits (when they are not kept yet) and marks it as in the production
// branch if they all arrived there already, for a merged PR just linked or just merged. Best
// effort: whatever GitHub cannot answer now is asked again at the next push.
export async function releaseIfArrived(
  db: Db,
  workspaceId: string,
  ref: PrRef,
  signal?: AbortSignal,
) {
  const waiting = await db
    .selectFrom("taskPullRequests")
    .select("id")
    .where("repo", "=", ref.repo)
    .where("number", "=", ref.number)
    .where("state", "=", "merged")
    .where("releasedTo", "is", null)
    .where(inWorkspace(workspaceId))
    .executeTakeFirst()
  if (!waiting) return []
  const hook = await workspaceWebhook(db, workspaceId)
  const productionBranch = hook?.productionBranch ?? DEFAULT_PRODUCTION_BRANCH
  const kept = await db
    .selectFrom("pullRequestCommits")
    .select("fingerprint")
    .where("workspaceId", "=", workspaceId)
    .where("repo", "=", ref.repo)
    .where("number", "=", ref.number)
    .executeTakeFirst()
  if (!kept && hook?.token) await rememberCommits(db, workspaceId, ref, hook.token, signal)
  return releaseByFingerprint(db, workspaceId, productionBranch, ref.repo, ref.number)
}

// Marks by hand a task's merged PRs that are not found in the production branch yet as in it,
// recording who did. Nothing undoes it: the webhook only ever fills in an empty releasedTo.
export async function markReleased(
  trx: Db,
  task: { id: string; workspaceId: string },
  userId: string,
) {
  const hook = await workspaceWebhook(trx, task.workspaceId)
  const marked = await trx
    .updateTable("taskPullRequests")
    .set({
      releasedTo: hook?.productionBranch ?? DEFAULT_PRODUCTION_BRANCH,
      releasedBy: userId,
      updatedAt: now(),
    })
    .where("taskId", "=", task.id)
    .where("state", "=", "merged")
    .where("releasedTo", "is", null)
    .returning("id")
    .execute()
  if (marked.length === 0) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "released: the task has no merged pull requests waiting to reach the production branch",
    )
  }
}
