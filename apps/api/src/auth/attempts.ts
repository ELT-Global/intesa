export const MAX_CODE_ATTEMPTS = 5
export const LOCKOUT_MS = 5 * 60 * 1000

export type AttemptLimiter = ReturnType<typeof createAttemptLimiter>

// In-memory limiter for code guessing, keyed by user. Each try is counted when it starts
// (before the code is checked), so a burst of parallel requests cannot get more than `max`
// checks. Once the budget is spent the key stays locked until `lockoutMs` after its last
// try. State is per process, which suits the single-service deployment.
export function createAttemptLimiter(
  max: number,
  lockoutMs: number,
  clock: () => number = Date.now,
) {
  const entries = new Map<string, { tries: number; until: number }>()

  const prune = (at: number) => {
    for (const [key, entry] of entries) if (entry.until <= at) entries.delete(key)
  }

  return {
    // "locked": do not check the code. "last": check it, but this was the final try.
    take(key: string): "ok" | "last" | "locked" {
      const at = clock()
      prune(at)
      const entry = entries.get(key) ?? { tries: 0, until: 0 }
      if (entry.tries >= max) return "locked"
      entry.tries += 1
      entry.until = at + lockoutMs
      entries.set(key, entry)
      return entry.tries >= max ? "last" : "ok"
    },
    reset(key: string) {
      entries.delete(key)
    },
    size: () => entries.size,
  }
}
