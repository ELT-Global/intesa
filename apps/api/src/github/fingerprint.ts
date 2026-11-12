import { createHash } from "node:crypto"

// The parts of a commit that a rebase keeps: GitHub's "Rebase and merge", `git rebase` (also
// when it resolves conflicts) and `git cherry-pick` all give a commit a new id and committer
// date, but keep its author, author date and message. Push payloads and the REST API both
// describe a commit with these.
export type CommitIdentity = {
  message: string
  author?: { email?: string | null; date?: string | null } | null
}

// `git cherry-pick -x` appends this line; the copy is the same commit.
const CHERRY_PICKED = /^\(cherry picked from commit [0-9a-f]+\)$/

// The message as git would compare it: Unix line endings, no trailing whitespace on any line,
// no cherry-pick note, and no blank lines at the end.
export function normalizeMessage(message: string) {
  return message
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !CHERRY_PICKED.test(line))
    .join("\n")
    .trim()
}

// Identifies a commit across rebases. The author date is compared as an instant, since push
// payloads give it in the author's time zone (+05:30) and the REST API in UTC (Z). Undefined
// when the commit says too little to be recognised again.
export function commitFingerprint(commit: CommitIdentity): string | undefined {
  const email = commit.author?.email?.trim().toLowerCase()
  const time = Date.parse(commit.author?.date ?? "")
  if (!email || Number.isNaN(time)) return undefined
  return createHash("sha256")
    .update(`${email}\n${Math.floor(time / 1000)}\n${normalizeMessage(commit.message)}`)
    .digest("hex")
}
