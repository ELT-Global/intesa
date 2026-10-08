/**
 * Local, per-browser user preferences kept in one versioned localStorage entry.
 *
 * Everything read back is untrusted: the entry may be missing, hand-edited, written by an
 * older or newer build, or blocked by the browser. Each field has a sanitizer that returns
 * `undefined` for anything unusable, so callers fall back to their defaults instead of failing.
 */

const STORAGE_KEY = "intesa-preferences"
const VERSION = 1
const MAX_IDS = 200
const MAX_PROJECTS = 200

type Stored = {
  /** Selected assignee ids per project board. `[]` means everyone; absent means the default. */
  boardAssignees: Record<string, string[]>
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function sanitizeIds(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const ids = v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 100)
  // A list with entries but none usable is corrupt, not "everyone" (which is an empty list).
  if (v.length > 0 && ids.length === 0) return undefined
  return [...new Set(ids)].slice(0, MAX_IDS)
}

function sanitizeBoardAssignees(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!isRecord(v)) return out
  for (const [projectId, ids] of Object.entries(v).slice(0, MAX_PROJECTS)) {
    const clean = sanitizeIds(ids)
    if (clean) out[projectId] = clean
  }
  return out
}

function read(): Stored {
  const empty: Stored = { boardAssignees: {} }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.v !== VERSION) return empty
    return { boardAssignees: sanitizeBoardAssignees(parsed.boardAssignees) }
  } catch {
    return empty
  }
}

function write(next: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, ...next }))
  } catch {
    // Storage is unavailable or full; preferences just won't persist.
  }
}

/** The saved assignee filter for a project, or `null` when none is saved (use the default). */
export function getBoardAssignees(projectId: string): string[] | null {
  return read().boardAssignees[projectId] ?? null
}

/** Saves the assignee filter for a project; `null` forgets it so the default applies again. */
export function setBoardAssignees(projectId: string, ids: string[] | null) {
  const current = read()
  const { [projectId]: _dropped, ...rest } = current.boardAssignees
  const clean = ids && sanitizeIds(ids)
  write({ ...current, boardAssignees: clean ? { ...rest, [projectId]: clean } : rest })
}
