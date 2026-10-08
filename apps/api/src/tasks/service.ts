import { type Selectable, sql, type Updateable } from "kysely"
import { type Db, inTransaction, newId, now } from "../db"
import type { TaskTable } from "../db/schema"
import { ApiError } from "../lib/errors"
import type { ProjectRow } from "../projects/service"
import type { Role } from "../workspaces/membership"
import { applyCustomFields, loadCustomFieldValues } from "./custom-fields"
import { byBoardOrder, positionFor } from "./order"
import { loadRelationships } from "./relationships"
import type { CreateTaskInput, PatchTaskInput, Priority, Status } from "./schemas"

export type TaskRow = Selectable<TaskTable>

export type UserRef = { id: string; name: string; avatarUrl: string | null }
export type TagRef = { id: string; name: string; color: string }
export type TaskRef = { id: string; key: string; title: string; status: Status }

export type TaskSummary = {
  id: string
  projectId: string
  number: number
  key: string
  title: string
  /** The markdown description. */
  body: string | null
  status: Status
  priority: Priority | null
  dueAt: string | null
  parentTaskId: string | null
  assignees: UserRef[]
  tags: TagRef[]
  subtaskCount: number
  subtaskDoneCount: number
  createdAt: string
  updatedAt: string
}

export type TaskDetail = TaskSummary & {
  project: { id: string; name: string; key: string }
  parent: TaskRef | null
  subtasks: TaskSummary[]
  blockedBy: TaskRef[]
  blocks: TaskRef[]
  related: TaskRef[]
  customFields: Record<string, unknown>
}

export type HistoryEntry = {
  id: string
  fromStatus: Status | null
  toStatus: Status
  updatedAt: string
  updatedBy: UserRef
}

const groupBy = <T, K>(items: T[], key: (item: T) => K): Map<K, T[]> => {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

// Which tasks to summarise. Related data is fetched with a subquery on the same filter, so
// the number of bound parameters stays constant however many tasks match.
export type TaskScope =
  | { ids: string[] }
  | { projectId: string; topLevel?: boolean }
  | { workspaceId: string; assigneeId: string; excludeComplete?: boolean; limit?: number }
  | { workspaceId: string; dueThrough: string; limit: number }

const scopedIds = (db: Db, scope: TaskScope) => {
  const q = db.selectFrom("tasks").select("tasks.id")
  if ("ids" in scope) return q.where("tasks.id", "in", scope.ids)
  if ("projectId" in scope) {
    const inProject = q.where("tasks.projectId", "=", scope.projectId)
    return scope.topLevel ? inProject.where("tasks.parentTaskId", "is", null) : inProject
  }
  if ("assigneeId" in scope) {
    const mine = q
      .innerJoin("taskAssignees", "taskAssignees.taskId", "tasks.id")
      .where("tasks.workspaceId", "=", scope.workspaceId)
      .where("taskAssignees.userId", "=", scope.assigneeId)
      .orderBy("tasks.updatedAt", "desc")
      .orderBy("tasks.id")
    const open = scope.excludeComplete ? mine.where("tasks.status", "!=", "complete") : mine
    return scope.limit ? open.limit(scope.limit) : open
  }
  return q
    .where("tasks.workspaceId", "=", scope.workspaceId)
    .where("tasks.status", "!=", "complete")
    .where("tasks.dueAt", "is not", null)
    .where("tasks.dueAt", "<=", scope.dueThrough)
    .orderBy("tasks.dueAt")
    .orderBy("tasks.createdAt")
    .orderBy("tasks.id")
    .limit(scope.limit)
}

// Builds summaries with a fixed number of queries (tasks, assignees, tags, subtask counts).
// By ids the result keeps the order of the ids; by project it is in board order (each status
// column reads top to bottom); assigned work is most recently updated first and due work is
// soonest due first.
// Later features add data here, not new round trips.
async function summarise(db: Db, scope: TaskScope): Promise<TaskSummary[]> {
  if ("ids" in scope && scope.ids.length === 0) return []

  const [tasks, assignees, tags, subtasks] = await Promise.all([
    db
      .selectFrom("tasks")
      .innerJoin("projects", "projects.id", "tasks.projectId")
      .select([
        "tasks.id",
        "tasks.projectId",
        "tasks.number",
        "tasks.title",
        "tasks.body",
        "tasks.status",
        "tasks.priority",
        "tasks.dueAt",
        "tasks.parentTaskId",
        "tasks.position",
        "tasks.createdAt",
        "tasks.updatedAt",
        "projects.key as projectKey",
      ])
      .where("tasks.id", "in", scopedIds(db, scope))
      .$call((q) => {
        if ("assigneeId" in scope) return q.orderBy("tasks.updatedAt", "desc").orderBy("tasks.id")
        if ("dueThrough" in scope) {
          return q.orderBy("tasks.dueAt").orderBy("tasks.createdAt").orderBy("tasks.id")
        }
        return q.orderBy("tasks.number", "desc")
      })
      .execute(),
    db
      .selectFrom("taskAssignees")
      .innerJoin("users", "users.id", "taskAssignees.userId")
      .select(["taskAssignees.taskId", "users.id", "users.name", "users.avatarUrl"])
      .where("taskAssignees.taskId", "in", scopedIds(db, scope))
      .orderBy("users.name")
      .execute(),
    db
      .selectFrom("taskTags")
      .innerJoin("tags", "tags.id", "taskTags.tagId")
      .select(["taskTags.taskId", "tags.id", "tags.name", "tags.color"])
      .where("taskTags.taskId", "in", scopedIds(db, scope))
      .orderBy("tags.name")
      .execute(),
    db
      .selectFrom("tasks")
      .select([
        "parentTaskId",
        sql<number | string>`count(*)`.as("total"),
        sql<number | string>`sum(case when status = 'complete' then 1 else 0 end)`.as("done"),
      ])
      .where("parentTaskId", "in", scopedIds(db, scope))
      .groupBy("parentTaskId")
      .execute(),
  ])

  // Not in SQL: see tasks/order.ts.
  if ("projectId" in scope) tasks.sort(byBoardOrder)

  const assigneesByTask = groupBy(assignees, (a) => a.taskId)
  const tagsByTask = groupBy(tags, (t) => t.taskId)
  const countsByTask = new Map(subtasks.map((s) => [s.parentTaskId, s]))

  const summaries = tasks.map((t): TaskSummary => {
    const counts = countsByTask.get(t.id)
    return {
      id: t.id,
      projectId: t.projectId,
      number: t.number,
      key: `${t.projectKey}-${t.number}`,
      title: t.title,
      body: t.body,
      status: t.status as Status,
      priority: t.priority as Priority | null,
      dueAt: t.dueAt,
      parentTaskId: t.parentTaskId,
      assignees: (assigneesByTask.get(t.id) ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        avatarUrl: a.avatarUrl,
      })),
      tags: (tagsByTask.get(t.id) ?? []).map((g) => ({ id: g.id, name: g.name, color: g.color })),
      subtaskCount: Number(counts?.total ?? 0),
      subtaskDoneCount: Number(counts?.done ?? 0),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }
  })

  if (!("ids" in scope)) return summaries
  const byId = new Map(summaries.map((t) => [t.id, t]))
  return scope.ids.flatMap((id) => byId.get(id) ?? [])
}

export const loadTaskSummaries = (db: Db, ids: string[]) => summarise(db, { ids })

export const listAssignedTaskSummaries = (
  db: Db,
  workspaceId: string,
  assigneeId: string,
  opts: { excludeComplete?: boolean; limit?: number } = {},
) => summarise(db, { workspaceId, assigneeId, ...opts })

// Incomplete tasks in the workspace that are overdue or due on or before `through` (YYYY-MM-DD).
export const listDueTaskSummaries = (
  db: Db,
  workspaceId: string,
  dueThrough: string,
  limit: number,
) => summarise(db, { workspaceId, dueThrough, limit })

export const listProjectTaskSummaries = (db: Db, projectId: string, topLevelOnly = true) =>
  summarise(db, { projectId, topLevel: topLevelOnly })

export async function loadTaskDetail(db: Db, taskId: string): Promise<TaskDetail> {
  const [summary] = await loadTaskSummaries(db, [taskId])
  if (!summary) throw new ApiError("NOT_FOUND", "Task not found")

  const task = await db
    .selectFrom("tasks")
    .select("workspaceId")
    .where("id", "=", taskId)
    .executeTakeFirstOrThrow()

  const [project, parent, children, relationships, customFields] = await Promise.all([
    db
      .selectFrom("projects")
      .select(["id", "name", "key"])
      .where("id", "=", summary.projectId)
      .executeTakeFirstOrThrow(),
    summary.parentTaskId
      ? db
          .selectFrom("tasks")
          .innerJoin("projects", "projects.id", "tasks.projectId")
          .select(["tasks.id", "tasks.number", "tasks.title", "tasks.status", "projects.key"])
          .where("tasks.id", "=", summary.parentTaskId)
          .executeTakeFirst()
      : undefined,
    db
      .selectFrom("tasks")
      .select("id")
      .where("parentTaskId", "=", taskId)
      .orderBy("createdAt")
      .execute(),
    loadRelationships(db, { id: taskId, workspaceId: task.workspaceId }),
    loadCustomFieldValues(db, taskId),
  ])

  return {
    ...summary,
    project,
    parent: parent
      ? {
          id: parent.id,
          key: `${parent.key}-${parent.number}`,
          title: parent.title,
          status: parent.status as Status,
        }
      : null,
    subtasks: await loadTaskSummaries(
      db,
      children.map((c) => c.id),
    ),
    ...relationships,
    customFields,
  }
}

// Authorization for task-scoped routes (member of the task's workspace, else NOT_FOUND).
export async function requireTask(
  db: Db,
  userId: string,
  taskId: string,
): Promise<{ task: TaskRow; role: Role }> {
  const row = await db
    .selectFrom("tasks")
    .leftJoin("workspaceMembers", (join) =>
      join
        .onRef("workspaceMembers.workspaceId", "=", "tasks.workspaceId")
        .on("workspaceMembers.userId", "=", userId),
    )
    .selectAll("tasks")
    .select("workspaceMembers.role")
    .where("tasks.id", "=", taskId)
    .executeTakeFirst()
  if (!row?.role) throw new ApiError("NOT_FOUND", "Task not found")
  const { role, ...task } = row
  return { task, role }
}

async function assertAssignees(db: Db, workspaceId: string, userIds: string[]) {
  if (userIds.length === 0) return
  const rows = await db
    .selectFrom("workspaceMembers")
    .select("userId")
    .where("workspaceId", "=", workspaceId)
    .where("userId", "in", userIds)
    .execute()
  if (rows.length !== userIds.length) {
    throw new ApiError("VALIDATION_ERROR", "assigneeIds: every assignee must be a workspace member")
  }
}

async function assertTags(db: Db, workspaceId: string, tagIds: string[]) {
  if (tagIds.length === 0) return
  const rows = await db
    .selectFrom("tags")
    .select("id")
    .where("workspaceId", "=", workspaceId)
    .where("id", "in", tagIds)
    .execute()
  if (rows.length !== tagIds.length) {
    throw new ApiError("VALIDATION_ERROR", "tagIds: every tag must belong to this workspace")
  }
}

async function replaceAssignees(db: Db, taskId: string, userIds: string[]) {
  await db.deleteFrom("taskAssignees").where("taskId", "=", taskId).execute()
  if (userIds.length > 0) {
    await db
      .insertInto("taskAssignees")
      .values(userIds.map((userId) => ({ taskId, userId })))
      .execute()
  }
}

async function replaceTags(db: Db, taskId: string, tagIds: string[]) {
  await db.deleteFrom("taskTags").where("taskId", "=", taskId).execute()
  if (tagIds.length > 0) {
    await db
      .insertInto("taskTags")
      .values(tagIds.map((tagId) => ({ taskId, tagId })))
      .execute()
  }
}

const unique = (ids: string[] | undefined) => [...new Set(ids ?? [])]

export async function createTask(
  db: Db,
  userId: string,
  project: ProjectRow,
  input: CreateTaskInput,
): Promise<string> {
  const assigneeIds = unique(input.assigneeIds)
  const tagIds = unique(input.tagIds)

  return inTransaction(db, async (trx) => {
    if (input.parentTaskId) {
      const parent = await trx
        .selectFrom("tasks")
        .select(["projectId", "parentTaskId"])
        .where("id", "=", input.parentTaskId)
        .executeTakeFirst()
      if (!parent || parent.projectId !== project.id) {
        throw new ApiError("VALIDATION_ERROR", "parentTaskId: parent must be in the same project")
      }
      if (parent.parentTaskId) {
        throw new ApiError("VALIDATION_ERROR", "parentTaskId: subtasks cannot have subtasks")
      }
    }
    await assertAssignees(trx, project.workspaceId, assigneeIds)
    await assertTags(trx, project.workspaceId, tagIds)

    // The increment and the insert share a transaction, so numbers are gap-free and unique.
    const { taskCounter } = await trx
      .updateTable("projects")
      .set((eb) => ({ taskCounter: eb("taskCounter", "+", 1) }))
      .where("id", "=", project.id)
      .returning("taskCounter")
      .executeTakeFirstOrThrow()

    // New tasks go to the top of their column.
    const position = await positionFor(
      trx,
      { projectId: project.id, parentTaskId: input.parentTaskId ?? null, status: input.status },
      "first",
    )

    const id = newId()
    const ts = now()
    await trx
      .insertInto("tasks")
      .values({
        id,
        workspaceId: project.workspaceId,
        projectId: project.id,
        parentTaskId: input.parentTaskId ?? null,
        number: taskCounter,
        title: input.title,
        body: input.body ?? null,
        status: input.status,
        priority: input.priority ?? null,
        dueAt: input.dueAt ?? null,
        position,
        createdBy: userId,
        createdAt: ts,
        updatedAt: ts,
      })
      .execute()
    await trx
      .insertInto("taskStatusHistory")
      .values({
        id: newId(),
        taskId: id,
        fromStatus: null,
        toStatus: input.status,
        updatedAt: ts,
        updatedBy: userId,
      })
      .execute()
    await replaceAssignees(trx, id, assigneeIds)
    await replaceTags(trx, id, tagIds)
    return id
  })
}

const insertHistory = (
  trx: Db,
  taskId: string,
  from: string | null,
  to: Status,
  userId: string,
  ts: string,
) =>
  trx
    .insertInto("taskStatusHistory")
    .values({
      id: newId(),
      taskId,
      fromStatus: from,
      toStatus: to,
      updatedAt: ts,
      updatedBy: userId,
    })
    .execute()

// Writes the new status and its history row together, or neither. Returns false when the
// status was already the requested one.
export async function changeTaskStatus(
  db: Db,
  taskId: string,
  status: Status,
  userId: string,
): Promise<boolean> {
  return inTransaction(db, async (trx) => {
    const current = await trx
      .selectFrom("tasks")
      .select("status")
      .where("id", "=", taskId)
      .executeTakeFirstOrThrow()
    if (current.status === status) return false

    const ts = now()
    await trx.updateTable("tasks").set({ status, updatedAt: ts }).where("id", "=", taskId).execute()
    await insertHistory(trx, taskId, current.status, status, userId, ts)
    return true
  })
}

// Applies every field of the patch in one transaction, writing the task row (and its
// updatedAt) once at the end; a rejected value rolls everything back. Moving a card within
// its column changes only its position, which is not an edit and leaves updatedAt alone.
export async function updateTask(
  db: Db,
  userId: string,
  task: TaskRow,
  patch: PatchTaskInput,
): Promise<void> {
  await inTransaction(db, async (trx) => {
    if (patch.assigneeIds) await assertAssignees(trx, task.workspaceId, unique(patch.assigneeIds))
    if (patch.tagIds) await assertTags(trx, task.workspaceId, unique(patch.tagIds))

    const ts = now()
    const { placement } = patch
    const set: Updateable<TaskTable> = {
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.body !== undefined && { body: patch.body }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.dueAt !== undefined && { dueAt: patch.dueAt }),
    }
    let changed =
      Object.keys(set).length > 0 ||
      patch.assigneeIds !== undefined ||
      patch.tagIds !== undefined ||
      patch.customFields !== undefined

    let moved = false
    if (patch.status !== undefined || placement !== undefined) {
      const current = await trx
        .selectFrom("tasks")
        .select("status")
        .where("id", "=", task.id)
        .executeTakeFirstOrThrow()
      const status = patch.status ?? (current.status as Status)
      const column = { projectId: task.projectId, parentTaskId: task.parentTaskId, status }
      if (current.status !== status) {
        set.status = status
        await insertHistory(trx, task.id, current.status, status, userId, ts)
        changed = true
        set.position = await positionFor(trx, column, placement ?? "first", task.id)
      } else if (placement !== undefined) {
        set.position = await positionFor(trx, column, placement, task.id)
        moved = true
      }
    }

    if (patch.assigneeIds) await replaceAssignees(trx, task.id, unique(patch.assigneeIds))
    if (patch.tagIds) await replaceTags(trx, task.id, unique(patch.tagIds))
    if (patch.customFields) await applyCustomFields(trx, task, patch.customFields)
    if (changed || moved) {
      await trx
        .updateTable("tasks")
        .set(changed ? { ...set, updatedAt: ts } : set)
        .where("id", "=", task.id)
        .execute()
    }
  })
}

export async function listHistory(db: Db, taskId: string): Promise<HistoryEntry[]> {
  const rows = await db
    .selectFrom("taskStatusHistory")
    .innerJoin("users", "users.id", "taskStatusHistory.updatedBy")
    .select([
      "taskStatusHistory.id",
      "taskStatusHistory.fromStatus",
      "taskStatusHistory.toStatus",
      "taskStatusHistory.updatedAt",
      "users.id as userId",
      "users.name",
      "users.avatarUrl",
    ])
    .where("taskStatusHistory.taskId", "=", taskId)
    .orderBy("taskStatusHistory.updatedAt")
    .execute()
  return rows.map((r) => ({
    id: r.id,
    fromStatus: r.fromStatus as Status | null,
    toStatus: r.toStatus as Status,
    updatedAt: r.updatedAt,
    updatedBy: { id: r.userId, name: r.name, avatarUrl: r.avatarUrl },
  }))
}

export type TaskWithProject = TaskSummary & { project: { id: string; name: string; key: string } }

// Adds the project ref to summaries with a single extra query.
export async function withProjects(db: Db, tasks: TaskSummary[]): Promise<TaskWithProject[]> {
  if (tasks.length === 0) return []
  const projects = await db
    .selectFrom("projects")
    .select(["id", "name", "key"])
    .where("id", "in", [...new Set(tasks.map((t) => t.projectId))])
    .execute()
  const byId = new Map(projects.map((p) => [p.id, p]))
  return tasks.flatMap((t) => {
    const project = byId.get(t.projectId)
    return project ? [{ ...t, project }] : []
  })
}
