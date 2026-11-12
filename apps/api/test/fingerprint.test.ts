import { describe, expect, test } from "bun:test"
import { commitFingerprint, normalizeMessage } from "../src/github/fingerprint"

const commit = {
  message: "feat: discounts\n\nTen percent off.",
  author: { email: "mei@example.com", date: "2026-11-12T06:01:25Z" },
}

describe("commit fingerprints", () => {
  test("a rebased copy has the same fingerprint, whatever time zone its author date is in", () => {
    const copy = {
      message: "feat: discounts\r\n\r\nTen percent off.  \n\n",
      author: { email: "Mei@Example.com", date: "2026-11-12T11:31:25+05:30" },
    }
    expect(commitFingerprint(copy)).toBe(commitFingerprint(commit) as string)
  })

  test("a cherry-pick's note is left out", () => {
    const picked = {
      ...commit,
      message: `${commit.message}\n\n(cherry picked from commit 0f086bc1)`,
    }
    expect(commitFingerprint(picked)).toBe(commitFingerprint(commit) as string)
    expect(normalizeMessage("fix\n\n(cherry picked from commit abc123)\n")).toBe("fix")
  })

  test("another author, author date or message is another commit", () => {
    const fingerprint = commitFingerprint(commit)
    for (const other of [
      { ...commit, message: "feat: discounts (reworded)" },
      { ...commit, author: { ...commit.author, email: "alan@example.com" } },
      { ...commit, author: { ...commit.author, date: "2026-11-12T06:01:26Z" } },
    ]) {
      expect(commitFingerprint(other)).not.toBe(fingerprint as string)
    }
  })

  test("a commit without an author email or a readable date has none", () => {
    expect(commitFingerprint({ message: "x", author: null })).toBeUndefined()
    expect(
      commitFingerprint({ message: "x", author: { email: "a@b.c", date: "soon" } }),
    ).toBeUndefined()
    expect(
      commitFingerprint({ message: "x", author: { email: "", date: commit.author.date } }),
    ).toBeUndefined()
  })
})
