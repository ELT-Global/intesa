import { sql } from "kysely"
import { type Db, inTransaction, isUniqueViolation, newId, now } from "../db"
import { ApiError } from "../lib/errors"
import type { Status } from "./schemas"
import type { TaskRef, TaskRow } from "./service"

export const RELATION_TYPES = ["blocks", "blocked_by", "related"] as const
export type RelationType = (typeof RELATION_TYPES)[number]

// Refs are always scoped to one workspace, so an id from elsewhere can never leak a title.
export async function loadTaskRefs(db: Db, workspaceId: string, ids: string[]): Promise<TaskRef[]> {
  if (ids.length === 0) return []
  const rows = await db
    .selectFrom("tasks")
    .innerJoin("projects", "projects.id", "tasks.projectId")
    .select(["tasks.id", "tasks.number", "tasks.title", "tasks.status", "projects.key"])
    .where("tasks.workspaceId", "=", workspaceId)
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
export async function loadRelationships(db: Db, task: { id: string; workspaceId: string }) {
  const taskId = task.id
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
    (
      await loadTaskRefs(db, task.workspaceId, [...ids.blocks, ...ids.blockedBy, ...ids.related])
    ).map((r) => [r.id, r]),
  )
  const pick = (list: string[]) => list.flatMap((id) => refs.get(id) ?? [])
  return { blocks: pick(ids.blocks), blockedBy: pick(ids.blockedBy), related: pick(ids.related) }
}

// "blocked_by" is stored as the other task blocking this one. "related" is symmetric, so it
// is stored with the ids in sorted order; the unique constraint then also catches the
// reversed duplicate.
function storedEdge(type: RelationType, taskId: string, otherId: string) {
  if (type === "related") {
    const [source, target] = [taskId, otherId].sort() as [string, string]
    return { source, target, storedType: "related" as const }
  }
  const [source, target] = type === "blocked_by" ? [otherId, taskId] : [taskId, otherId]
  return { source, target, storedType: "blocks" as const }
}

// Tasks in other workspaces are indistinguishable from missing ones.
async function requireSameWorkspace(db: Db, workspaceId: string, otherId: string) {
  const other = await db
    .selectFrom("tasks")
    .select("id")
    .where("id", "=", otherId)
    .where("workspaceId", "=", workspaceId)
    .executeTakeFirst()
  if (!other) throw new ApiError("NOT_FOUND", "Task not found")
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
  await requireSameWorkspace(db, task.workspaceId, otherId)
  const { source, target, storedType } = storedEdge(type, task.id, otherId)
  const exists = new ApiError("CONFLICT", "That relationship already exists")

  await inTransaction(db, async (trx) => {
    if (storedType === "blocks") {
      // Two requests could each pass the cycle check below and then both insert (A->B and
      // B->A). Taking a row lock on the workspace first (a no-op update) serialises block
      // writes within it. This relies on READ COMMITTED, the default on Postgres: the second
      // transaction waits for the first to commit and then sees its edge. SQLite runs one
      // writer at a time, so it needs nothing extra. Related links cannot cycle and are
      // protected by the unique constraint alone, so they skip the lock.
      await trx
        .updateTable("workspaces")
        .set((eb) => ({ updatedAt: eb.ref("updatedAt") }))
        .where("id", "=", task.workspaceId)
        .execute()

      // Adding source -> target closes a loop if source is already reachable from target.
      const { rows } = await sql<{ id: string }>`
        with recursive reach(id) as (
          select cast(${target} as text)
          union
          select r.target_task_id from task_relationships r
            join reach on r.source_task_id = reach.id
            where r.type = 'blocks'
        )
        select id from reach where id = ${source}`.execute(trx)
      if (rows.length > 0) {
        throw new ApiError("CONFLICT", "That would create a circular block")
      }
    }

    try {
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
    } catch (err) {
      if (isUniqueViolation(err)) throw exists
      throw err
    }
  })
}

export async function removeRelationship(
  db: Db,
  task: { id: string; workspaceId: string },
  type: RelationType,
  otherId: string,
): Promise<void> {
  await requireSameWorkspace(db, task.workspaceId, otherId)
  const { source, target, storedType } = storedEdge(type, task.id, otherId)
  const result = await db
    .deleteFrom("taskRelationships")
    .where("type", "=", storedType)
    .where("sourceTaskId", "=", source)
    .where("targetTaskId", "=", target)
    .executeTakeFirst()
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
