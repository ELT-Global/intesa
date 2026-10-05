import { sql } from "kysely"
import { type Db, inTransaction, newId, now } from "../db"
import { ApiError } from "../lib/errors"
import type { Status } from "./schemas"
import type { TaskRef, TaskRow } from "./service"

export const RELATION_TYPES = ["blocks", "blocked_by", "related"] as const
export type RelationType = (typeof RELATION_TYPES)[number]

export async function loadTaskRefs(db: Db, ids: string[]): Promise<TaskRef[]> {
  if (ids.length === 0) return []
  const rows = await db
    .selectFrom("tasks")
    .innerJoin("projects", "projects.id", "tasks.projectId")
    .select(["tasks.id", "tasks.number", "tasks.title", "tasks.status", "projects.key"])
    .where("tasks.id", "in", ids)
    .orderBy("projects.key")
    .orderBy("tasks.number")
    .execute()
  return rows.map((r) => ({
    id: r.id,
    key: `${r.key}-${r.number}`,
    title: r.title,
    status: r.status as Status,
  }))
}

// One query for the edges, one for the referenced tasks.
export async function loadRelationships(db: Db, taskId: string) {
  const edges = await db
    .selectFrom("taskRelationships")
    .select(["sourceTaskId", "targetTaskId", "type"])
    .where((eb) => eb.or([eb("sourceTaskId", "=", taskId), eb("targetTaskId", "=", taskId)]))
    .execute()

  const ids = {
    blocks: edges
      .filter((e) => e.type === "blocks" && e.sourceTaskId === taskId)
      .map((e) => e.targetTaskId),
    blockedBy: edges
      .filter((e) => e.type === "blocks" && e.targetTaskId === taskId)
      .map((e) => e.sourceTaskId),
    related: edges
      .filter((e) => e.type === "related")
      .map((e) => (e.sourceTaskId === taskId ? e.targetTaskId : e.sourceTaskId)),
  }
  const refs = new Map(
    (await loadTaskRefs(db, [...ids.blocks, ...ids.blockedBy, ...ids.related])).map((r) => [
      r.id,
      r,
    ]),
  )
  const pick = (list: string[]) => list.flatMap((id) => refs.get(id) ?? [])
  return { blocks: pick(ids.blocks), blockedBy: pick(ids.blockedBy), related: pick(ids.related) }
}

export async function addRelationship(
  db: Db,
  task: TaskRow,
  type: RelationType,
  otherId: string,
): Promise<void> {
  if (otherId === task.id) {
    throw new ApiError("VALIDATION_ERROR", "A task cannot be related to itself")
  }
  const other = await db
    .selectFrom("tasks")
    .select("workspaceId")
    .where("id", "=", otherId)
    .executeTakeFirst()
  // Tasks in other workspaces are indistinguishable from missing ones.
  if (!other || other.workspaceId !== task.workspaceId) {
    throw new ApiError("NOT_FOUND", "Task not found")
  }

  // "blocked_by" is stored as the other task blocking this one.
  const [source, target] = type === "blocked_by" ? [otherId, task.id] : [task.id, otherId]
  const storedType = type === "related" ? "related" : "blocks"

  await inTransaction(db, async (trx) => {
    const forward = await trx
      .selectFrom("taskRelationships")
      .select("id")
      .where("sourceTaskId", "=", source)
      .where("targetTaskId", "=", target)
      .where("type", "=", storedType)
      .executeTakeFirst()
    if (forward) throw new ApiError("CONFLICT", "That relationship already exists")

    const reverse = await trx
      .selectFrom("taskRelationships")
      .select("id")
      .where("sourceTaskId", "=", target)
      .where("targetTaskId", "=", source)
      .where("type", "=", storedType)
      .executeTakeFirst()
    if (reverse) {
      throw new ApiError(
        "CONFLICT",
        storedType === "related"
          ? "That relationship already exists"
          : "These tasks already block each other in the other direction",
      )
    }

    await trx
      .insertInto("taskRelationships")
      .values({
        id: newId(),
        sourceTaskId: source,
        targetTaskId: target,
        type: storedType,
        createdAt: now(),
      })
      .execute()
  })
}

export async function removeRelationship(
  db: Db,
  taskId: string,
  type: RelationType,
  otherId: string,
): Promise<void> {
  const [source, target] = type === "blocked_by" ? [otherId, taskId] : [taskId, otherId]
  const storedType = type === "related" ? "related" : "blocks"

  let q = db.deleteFrom("taskRelationships").where("type", "=", storedType)
  q =
    storedType === "related"
      ? q.where((eb) =>
          eb.or([
            eb.and([eb("sourceTaskId", "=", taskId), eb("targetTaskId", "=", otherId)]),
            eb.and([eb("sourceTaskId", "=", otherId), eb("targetTaskId", "=", taskId)]),
          ]),
        )
      : q.where("sourceTaskId", "=", source).where("targetTaskId", "=", target)
  const result = await q.executeTakeFirst()
  if (Number(result.numDeletedRows) === 0) throw new ApiError("NOT_FOUND", "Relationship not found")
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

// Picker search: matches the title or the KEY-n identifier, newest activity first.
export async function searchTasks(db: Db, workspaceId: string, q: string): Promise<TaskRef[]> {
  const term = `%${escapeLike(q.trim().toLowerCase())}%`
  let query = db
    .selectFrom("tasks")
    .innerJoin("projects", "projects.id", "tasks.projectId")
    .select(["tasks.id", "tasks.number", "tasks.title", "tasks.status", "projects.key"])
    .where("tasks.workspaceId", "=", workspaceId)
  if (q.trim()) {
    query = query.where(
      sql<boolean>`(lower(tasks.title) like ${term} escape '\\' or lower(projects.key || '-' || tasks.number) like ${term} escape '\\')`,
    )
  }
  const rows = await query.orderBy("tasks.updatedAt", "desc").limit(20).execute()
  return rows.map((r) => ({
    id: r.id,
    key: `${r.key}-${r.number}`,
    title: r.title,
    status: r.status as Status,
  }))
}
