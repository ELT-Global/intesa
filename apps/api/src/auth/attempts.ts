export const MAX_CODE_ATTEMPTS = 5
export const LOCKOUT_MS = 5 * 60 * 1000

// In-memory consecutive-failure counter. State is per process, which is enough for the
// single-service deployment and resets on restart.
export function createAttemptLimiter(max: number, lockoutMs: number) {
  const entries = new Map<string, { fails: number; lockedUntil: number }>()
  return {
    isLocked(key: string): boolean {
      const entry = entries.get(key)
      if (!entry || entry.lockedUntil === 0) return false
      if (entry.lockedUntil > Date.now()) return true
      entries.delete(key)
      return false
    },
    // Records a failure; returns true when this one reached the limit.
    fail(key: string): boolean {
      const entry = entries.get(key) ?? { fails: 0, lockedUntil: 0 }
      entry.fails += 1
      const reached = entry.fails >= max
      if (reached) entry.lockedUntil = Date.now() + lockoutMs
      entries.set(key, entry)
      return reached
    },
    reset(key: string) {
      entries.delete(key)
    },
  }
}
