import { z } from "zod"
import { ApiError } from "../lib/errors"
import type { PullRequestState } from "../schemas"
import { commitFingerprint } from "./fingerprint"

// The parts of GitHub's pull request object that Intesa keeps. The REST API and webhook
// payloads share this shape. html_url is shown as a link, so only a github.com one is taken.
export const githubPullRequest = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().optional(),
  merged_at: z.string().nullish(),
  html_url: z.string().regex(/^https:\/\/github\.com\//, "Not a github.com link"),
  updated_at: z.string(),
  user: z.object({ login: z.string() }).nullish(),
  base: z.object({ ref: z.string() }),
  merge_commit_sha: z.string().nullish(),
})
export type GithubPullRequest = z.infer<typeof githubPullRequest>

export type PrRef = { repo: string; number: number }

// What is stored about a PR besides its repo and number.
export type PrDetails = {
  url: string
  title: string
  author: string | null
  state: PullRequestState
  baseBranch: string
  githubUpdatedAt: string
  // Only kept once merged: for an open PR GitHub reports a trial merge that may never happen.
  mergeCommitSha: string | null
}

export const prUrl = ({ repo, number }: PrRef) => `https://github.com/${repo}/pull/${number}`

export function prDetails(pr: GithubPullRequest): PrDetails {
  const state: PullRequestState = pr.merged_at
    ? "merged"
    : pr.state === "closed"
      ? "closed"
      : pr.draft
        ? "draft"
        : "open"
  return {
    url: pr.html_url,
    title: pr.title,
    author: pr.user?.login ?? null,
    state,
    baseBranch: pr.base.ref,
    githubUpdatedAt: pr.updated_at,
    mergeCommitSha: state === "merged" ? (pr.merge_commit_sha ?? null) : null,
  }
}

// Any page of the PR: .../pull/482, or its /files, /commits or /checks tab.
const URL_REF = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i
const REPO_REF = /^([\w.-]+\/[\w.-]+)#(\d+)$/

// Reads a PR link or "owner/repo#482". A bare number is refused: a workspace's webhook can hear
// from any number of repositories, so the number alone does not say which one.
export function parsePrRef(input: string): PrRef {
  const match = URL_REF.exec(input.trim()) ?? REPO_REF.exec(input.trim())
  const number = Number(match?.[2])
  // "." and ".." are no owner or repository, and would change the API path asked for.
  const dots = /(^|\/)\.\.?(\/|$)/.test(match?.[1] ?? "")
  if (!match || dots || !Number.isSafeInteger(number) || number < 1) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "pullRequest: paste the pull request's link, or write it as owner/repo#482",
    )
  }
  return { repo: (match[1] as string).toLowerCase(), number }
}

// Asks GitHub about a PR. "missing" means GitHub said it does not exist, which with a token is
// trustworthy; without one a private repository looks missing too, so that is not reported.
// Anything else that goes wrong (no answer, rate limit, an odd reply) gives undefined, and the
// details are filled in by the next webhook event instead.
export async function fetchPullRequest(
  ref: PrRef,
  token: string | null | undefined,
  signal?: AbortSignal,
): Promise<PrDetails | "missing" | undefined> {
  const pr = await fetchGithubPullRequest(ref, token, signal)
  return pr && pr !== "missing" ? prDetails(pr) : pr
}

// The same, with GitHub's whole view of the PR, its title and description included.
export async function fetchGithubPullRequest(
  ref: PrRef,
  token: string | null | undefined,
  signal?: AbortSignal,
): Promise<GithubPullRequest | "missing" | undefined> {
  const res = await githubGet(`repos/${ref.repo}/pulls/${ref.number}`, token, signal)
  if (res === undefined) return undefined
  if (res.status === 404 && token) return "missing"
  if (!res.ok) return undefined
  const parsed = githubPullRequest.safeParse(await res.json().catch(() => null))
  return parsed.success ? parsed.data : undefined
}

// A commit as the REST API describes it, in a PR's commit list or on its own.
const githubCommit = z.object({
  commit: z.object({
    message: z.string(),
    author: z.object({ email: z.string().nullish(), date: z.string().nullish() }).nullish(),
  }),
  parents: z.array(z.unknown()),
})

// GitHub lists at most this many of a PR's commits.
export const MAX_PR_COMMITS = 250

// The fingerprints of a PR's commits, leaving out merge commits (a rebase drops them, so they
// never reach another branch). "too-many" when GitHub may have left some out; undefined when
// it could not be asked.
export async function pullRequestCommits(
  ref: PrRef,
  token: string | null | undefined,
  signal?: AbortSignal,
): Promise<string[] | "too-many" | undefined> {
  const commits: z.infer<typeof githubCommit>[] = []
  for (let page = 1; commits.length < MAX_PR_COMMITS; page++) {
    const res = await githubGet(
      `repos/${ref.repo}/pulls/${ref.number}/commits?per_page=100&page=${page}`,
      token,
      signal,
    )
    if (!res?.ok) return undefined
    const parsed = z.array(githubCommit).safeParse(await res.json().catch(() => null))
    if (!parsed.success) return undefined
    commits.push(...parsed.data)
    if (parsed.data.length < 100) break
  }
  if (commits.length >= MAX_PR_COMMITS) return "too-many"
  return commits
    .filter((c) => c.parents.length <= 1)
    .map((c) => commitFingerprint(c.commit))
    .filter((f) => f !== undefined)
}

// The fingerprint of one commit, and whether it is a merge commit. Undefined when GitHub could
// not be asked or the commit says too little to be recognised.
export async function commitDetails(
  repo: string,
  sha: string,
  token: string | null | undefined,
  signal?: AbortSignal,
): Promise<{ fingerprint: string; merge: boolean } | undefined> {
  const res = await githubGet(`repos/${repo}/commits/${encodeURIComponent(sha)}`, token, signal)
  if (!res?.ok) return undefined
  const parsed = githubCommit.safeParse(await res.json().catch(() => null))
  if (!parsed.success) return undefined
  const fingerprint = commitFingerprint(parsed.data.commit)
  return fingerprint ? { fingerprint, merge: parsed.data.parents.length > 1 } : undefined
}

// A GET to GitHub's REST API, with the token when there is one. Undefined when GitHub could not
// be reached in time, or `signal` gave up waiting first.
async function githubGet(path: string, token: string | null | undefined, signal?: AbortSignal) {
  try {
    return await fetch(`https://api.github.com/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "intesa",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(5000), signal])
        : AbortSignal.timeout(5000),
    })
  } catch {
    return undefined
  }
}
