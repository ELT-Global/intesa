import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing"
import type { Db } from "../db"
import { ApiError } from "../lib/errors"
import type { Status } from "./schemas"

// Cards are ordered inside a column (project, status, parent) by `tasks.position`, a
// fractional-index key: a string that always has another key between any two others, so
// moving a card rewrites that one row. Keys compare as plain strings.
//
// Never ORDER BY position in SQL. Postgres sorts text by the database collation, which is
// not byte order, while SQLite sorts bytewise; sorting here gives both the same answer.

export type Placement = { before: string } | { after: string } | "first" | "last"

type Slot = { id: string; position: string; number: number }

/** Board order: by key, then newest first for the rare tie (concurrent moves into one gap). */
export const byBoardOrder = (
  a: { position: string; number: number },
  b: { position: string; number: number },
) => (a.position < b.position ? -1 : a.position > b.position ? 1 : b.number - a.number)

export type Column = { projectId: string; parentTaskId: string | null; status: Status }

async function loadColumn(db: Db, column: Column, excludeId?: string): Promise<Slot[]> {
  let q = db
    .selectFrom("tasks")
    .select(["id", "position", "number"])
    .where("projectId", "=", column.projectId)
    .where("status", "=", column.status)
    .where("parentTaskId", column.parentTaskId === null ? "is" : "=", column.parentTaskId)
  if (excludeId) q = q.where("id", "!=", excludeId)
  return (await q.execute()).sort(byBoardOrder)
}

// A key strictly between the neighbours, or undefined when there is none: equal neighbours
// (two moves raced into the same gap) or a key that is not a valid fractional index.
function keyBetween(before: string | undefined, after: string | undefined): string | undefined {
  if (before !== undefined && after !== undefined && before >= after) return undefined
  try {
    return generateKeyBetween(before ?? null, after ?? null)
  } catch {
    return undefined
  }
}

/**
 * The key that puts a task at `placement` in `column`, leaving every other task where it is.
 * `excludeId` is the task being moved; it cannot be its own anchor. Must run in the same
 * transaction as the write that stores the key.
 */
export async function positionFor(
  db: Db,
  column: Column,
  placement: Placement,
  excludeId?: string,
): Promise<string> {
  const others = await loadColumn(db, column, excludeId)

  let index: number
  if (placement === "first") index = 0
  else if (placement === "last") index = others.length
  else {
    const anchor = "before" in placement ? placement.before : placement.after
    const at = others.findIndex((t) => t.id === anchor)
    if (at < 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "placement: the task to place next to must be another task in the same column",
      )
    }
    index = "before" in placement ? at : at + 1
  }

  const key = keyBetween(others[index - 1]?.position, others[index]?.position)
  if (key !== undefined) return key

  // No room between the neighbours: respace the whole column (in its current order), which
  // leaves a gap everywhere. Only rows whose key changes are written.
  const fresh = generateNKeysBetween(null, null, others.length)
  for (const [i, t] of others.entries()) {
    const next = fresh[i] as string
    if (t.position === next) continue
    await db.updateTable("tasks").set({ position: next }).where("id", "=", t.id).execute()
    t.position = next
  }
  return generateKeyBetween(others[index - 1]?.position ?? null, others[index]?.position ?? null)
}
