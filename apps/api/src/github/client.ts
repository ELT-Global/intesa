import { z } from "zod"
import { ApiError } from "../lib/errors"
import type { PullRequestState } from "../schemas"

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
  if (!match || !Number.isSafeInteger(number) || number < 1) {
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
): Promise<PrDetails | "missing" | undefined> {
  try {
    const res = await fetch(`https://api.github.com/repos/${ref.repo}/pulls/${ref.number}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "intesa",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      signal: AbortSignal.timeout(5000),
    })
    if (res.status === 404 && token) return "missing"
    if (!res.ok) return undefined
    const parsed = githubPullRequest.safeParse(await res.json())
    return parsed.success ? prDetails(parsed.data) : undefined
  } catch {
    return undefined
  }
}
