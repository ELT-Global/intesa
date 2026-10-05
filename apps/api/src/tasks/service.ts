import { type Selectable, sql } from "kysely"
import { type Db, inTransaction, newId, now } from "../db"
import type { TaskTable } from "../db/schema"
import { ApiError } from "../lib/errors"
import type { ProjectRow } from "../projects/service"
import { type Role, requireMembership } from "../workspaces/membership"
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
  body: string | null
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

// Builds summaries for many tasks with a fixed number of queries (one per kind of related
// data), preserving the order of `ids`. Later features add data here, not new round trips.
export async function loadTaskSummaries(db: Db, ids: string[]): Promise<TaskSummary[]> {
  if (ids.length === 0) return []

  const [tasks, assignees, tags, subtasks] = await Promise.all([
    db
      .selectFrom("tasks")
      .innerJoin("projects", "projects.id", "tasks.projectId")
      .select([
        "tasks.id",
        "tasks.projectId",
        "tasks.number",
        "tasks.title",
        "tasks.status",
        "tasks.priority",
        "tasks.dueAt",
        "tasks.parentTaskId",
        "tasks.createdAt",
        "tasks.updatedAt",
        "projects.key as projectKey",
      ])
      .where("tasks.id", "in", ids)
      .execute(),
    db
      .selectFrom("taskAssignees")
      .innerJoin("users", "users.id", "taskAssignees.userId")
      .select(["taskAssignees.taskId", "users.id", "users.name", "users.avatarUrl"])
      .where("taskAssignees.taskId", "in", ids)
      .orderBy("users.name")
      .execute(),
    db
      .selectFrom("taskTags")
      .innerJoin("tags", "tags.id", "taskTags.tagId")
      .select(["taskTags.taskId", "tags.id", "tags.name", "tags.color"])
      .where("taskTags.taskId", "in", ids)
      .orderBy("tags.name")
      .execute(),
    db
      .selectFrom("tasks")
      .select([
        "parentTaskId",
        sql<number | string>`count(*)`.as("total"),
        sql<number | string>`sum(case when status = 'complete' then 1 else 0 end)`.as("done"),
      ])
      .where("parentTaskId", "in", ids)
      .groupBy("parentTaskId")
      .execute(),
  ])

  const assigneesByTask = groupBy(assignees, (a) => a.taskId)
  const tagsByTask = groupBy(tags, (t) => t.taskId)
  const countsByTask = new Map(subtasks.map((s) => [s.parentTaskId, s]))
  const byId = new Map(tasks.map((t) => [t.id, t]))

  return ids.flatMap((id) => {
    const t = byId.get(id)
    if (!t) return []
    const counts = countsByTask.get(id)
    return [
      {
        id: t.id,
        projectId: t.projectId,
        number: t.number,
        key: `${t.projectKey}-${t.number}`,
        title: t.title,
        status: t.status as Status,
        priority: t.priority as Priority | null,
        dueAt: t.dueAt,
        parentTaskId: t.parentTaskId,
        assignees: (assigneesByTask.get(id) ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          avatarUrl: a.avatarUrl,
        })),
        tags: (tagsByTask.get(id) ?? []).map((g) => ({ id: g.id, name: g.name, color: g.color })),
        subtaskCount: Number(counts?.total ?? 0),
        subtaskDoneCount: Number(counts?.done ?? 0),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      },
    ]
  })
}

export async function loadTaskDetail(db: Db, taskId: string): Promise<TaskDetail> {
  const [summary] = await loadTaskSummaries(db, [taskId])
  if (!summary) throw new ApiError("NOT_FOUND", "Task not found")

  const [task, project, parent, children] = await Promise.all([
    db.selectFrom("tasks").select("body").where("id", "=", taskId).executeTakeFirstOrThrow(),
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
  ])

  return {
    ...summary,
    body: task.body,
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
    blockedBy: [],
    blocks: [],
    related: [],
    customFields: {},
  }
}

// Authorization for task-scoped routes (member of the task's workspace, else NOT_FOUND).
export async function requireTask(
  db: Db,
  userId: string,
  taskId: string,
): Promise<{ task: TaskRow; role: Role }> {
  const task = await db.selectFrom("tasks").selectAll().where("id", "=", taskId).executeTakeFirst()
  if (!task) throw new ApiError("NOT_FOUND", "Task not found")
  const role = await requireMembership(db, userId, task.workspaceId).catch(() => {
    throw new ApiError("NOT_FOUND", "Task not found")
  })
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

// Writes the new status and its history row together, or neither. Joins an enclosing
// transaction when called from updateTask.
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
    await trx
      .insertInto("taskStatusHistory")
      .values({
        id: newId(),
        taskId,
        fromStatus: current.status,
        toStatus: status,
        updatedAt: ts,
        updatedBy: userId,
      })
      .execute()
    return true
  })
}

export async function updateTask(
  db: Db,
  userId: string,
  task: TaskRow,
  patch: PatchTaskInput,
): Promise<void> {
  await inTransaction(db, async (trx) => {
    if (patch.assigneeIds) await assertAssignees(trx, task.workspaceId, unique(patch.assigneeIds))
    if (patch.tagIds) await assertTags(trx, task.workspaceId, unique(patch.tagIds))

    const scalars = {
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.body !== undefined && { body: patch.body }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.dueAt !== undefined && { dueAt: patch.dueAt }),
    }
    if (Object.keys(scalars).length > 0) {
      await trx
        .updateTable("tasks")
        .set({ ...scalars, updatedAt: now() })
        .where("id", "=", task.id)
        .execute()
    }
    if (patch.status !== undefined) await changeTaskStatus(trx, task.id, patch.status, userId)
    if (patch.assigneeIds) await replaceAssignees(trx, task.id, unique(patch.assigneeIds))
    if (patch.tagIds) await replaceTags(trx, task.id, unique(patch.tagIds))
    if (patch.assigneeIds || patch.tagIds) {
      await trx.updateTable("tasks").set({ updatedAt: now() }).where("id", "=", task.id).execute()
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
