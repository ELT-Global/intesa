import type { Selectable } from "kysely"
import { type Db, inTransaction, newId, now } from "../db"
import type { BugTable } from "../db/schema"
import { ApiError } from "../lib/errors"
import type { Status } from "../tasks/schemas"
import { createTask, type UserRef } from "../tasks/service"
import { bugKey, findBugTagId, isPending } from "./links"
import { BUG_KEY_PATTERN, type BugStatus, type RegressionTaskInput } from "./schemas"

export type BugTask = {
  id: string
  key: string
  title: string
  status: Status
  /** When the task joined the bug. */
  createdAt: string
  /** When the task itself was created. */
  raisedAt: string
  /** When the task last moved to `complete`; null unless it is complete now. */
  completedAt: string | null
  /** Everyone ever assigned to the task, current or not, once each, by first assignment. */
  assignees: UserRef[]
}

export type BugSummary = {
  id: string
  projectId: string
  number: number
  key: string
  title: string
  status: BugStatus
  /** Oldest link first. */
  tasks: BugTask[]
  /** Tasks after the first, each opened because the bug came back. */
  regressions: number
  /** When the bug was resolved: its tasks' latest completion; null while pending or taskless. */
  fixedAt: string | null
  /** When the bug was first raised. */
  createdAt: string
  updatedAt: string
}

/** Also the bug's own description, and each task's, which the bug shows read-only. */
export type BugDetail = Omit<BugSummary, "tasks"> & {
  body: string | null
  tasks: (BugTask & { body: string | null })[]
}

type BugScope = { ids: string[] } | { projectId: string }

const scopedIds = (db: Db, scope: BugScope) => {
  const q = db.selectFrom("bugs").select("bugs.id")
  return "ids" in scope
    ? q.where("bugs.id", "in", scope.ids)
    : q.where("bugs.projectId", "=", scope.projectId)
}

// Three queries however many bugs match: the bugs, their tasks (with when each was last
// completed) and everyone ever assigned to those tasks. Pending bugs come first, then the newest.
async function loadBugs(db: Db, scope: BugScope): Promise<BugDetail[]> {
  if ("ids" in scope && scope.ids.length === 0) return []
  const linkedTaskIds = db
    .selectFrom("bugTasks")
    .select("bugTasks.taskId")
    .where("bugTasks.bugId", "in", scopedIds(db, scope))
  const [bugs, links, assignees] = await Promise.all([
    db
      .selectFrom("bugs")
      .innerJoin("projects", "projects.id", "bugs.projectId")
      .select([
        "bugs.id",
        "bugs.projectId",
        "bugs.number",
        "bugs.title",
        "bugs.body",
        "bugs.createdAt",
        "bugs.updatedAt",
        "projects.key as projectKey",
      ])
      .where("bugs.id", "in", scopedIds(db, scope))
      .execute(),
    db
      .selectFrom("bugTasks")
      .innerJoin("tasks", "tasks.id", "bugTasks.taskId")
      .innerJoin("projects", "projects.id", "tasks.projectId")
      .select([
        "bugTasks.bugId",
        "bugTasks.createdAt",
        "tasks.id",
        "tasks.number",
        "tasks.title",
        "tasks.status",
        "tasks.body",
        "tasks.createdAt as raisedAt",
        "projects.key",
      ])
      .select((eb) =>
        eb
          .selectFrom("taskStatusHistory")
          .select((h) => h.fn.max("taskStatusHistory.updatedAt").as("at"))
          .whereRef("taskStatusHistory.taskId", "=", "tasks.id")
          .where("taskStatusHistory.toStatus", "=", "complete")
          .as("completedAt"),
      )
      .where("bugTasks.bugId", "in", scopedIds(db, scope))
      .orderBy("bugTasks.createdAt")
      .orderBy("tasks.number")
      .execute(),
    // Past assignments count too: the people who worked on a task, not only who holds it now.
    db
      .selectFrom("taskAssignments")
      .innerJoin("users", "users.id", "taskAssignments.userId")
      .select(["taskAssignments.taskId", "users.id", "users.name", "users.avatarUrl"])
      .where("taskAssignments.taskId", "in", linkedTaskIds)
      .groupBy(["taskAssignments.taskId", "users.id", "users.name", "users.avatarUrl"])
      .orderBy((eb) => eb.fn.min("taskAssignments.assignedAt"))
      .orderBy("users.name")
      .execute(),
  ])

  const assigneesByTask = new Map<string, UserRef[]>()
  for (const { taskId, ...user } of assignees) {
    assigneesByTask.set(taskId, [...(assigneesByTask.get(taskId) ?? []), user])
  }

  const tasksByBug = new Map<string, BugDetail["tasks"]>()
  for (const link of links) {
    const task = {
      id: link.id,
      key: `${link.key}-${link.number}`,
      title: link.title,
      status: link.status as Status,
      createdAt: link.createdAt,
      raisedAt: link.raisedAt,
      completedAt: link.status === "complete" ? (link.completedAt ?? null) : null,
      assignees: assigneesByTask.get(link.id) ?? [],
      body: link.body,
    }
    tasksByBug.set(link.bugId, [...(tasksByBug.get(link.bugId) ?? []), task])
  }

  return bugs
    .map((bug): BugDetail => {
      const tasks = tasksByBug.get(bug.id) ?? []
      const status = tasks.some((t) => t.status !== "complete") ? "pending" : "resolved"
      const completions = tasks.map((t) => t.completedAt ?? "").sort()
      return {
        id: bug.id,
        projectId: bug.projectId,
        number: bug.number,
        key: bugKey(bug.projectKey, bug.number),
        title: bug.title,
        status,
        tasks,
        regressions: Math.max(tasks.length - 1, 0),
        fixedAt: (status === "resolved" && completions.at(-1)) || null,
        createdAt: bug.createdAt,
        updatedAt: bug.updatedAt,
        body: bug.body,
      }
    })
    .sort((a, b) => (a.status === b.status ? b.number - a.number : a.status === "pending" ? -1 : 1))
}

export async function loadBug(db: Db, bugId: string): Promise<BugDetail> {
  const [bug] = await loadBugs(db, { ids: [bugId] })
  if (!bug) throw new ApiError("NOT_FOUND", "Bug not found")
  return bug
}

export async function listProjectBugs(
  db: Db,
  projectId: string,
  status?: BugStatus,
): Promise<BugSummary[]> {
  const bugs = await loadBugs(db, { projectId })
  return bugs
    .filter((bug) => !status || bug.status === status)
    .map(({ body: _body, tasks, ...summary }) => ({
      ...summary,
      tasks: tasks.map(({ body: _taskBody, ...task }) => task),
    }))
}

export type BugRow = Selectable<BugTable> & { workspaceId: string }

// Authorization for bug-scoped routes (member of the bug's workspace, else NOT_FOUND).
export async function requireBug(db: Db, userId: string, bugId: string): Promise<BugRow> {
  const row = await db
    .selectFrom("bugs")
    .innerJoin("projects", "projects.id", "bugs.projectId")
    .leftJoin("workspaceMembers", (join) =>
      join
        .onRef("workspaceMembers.workspaceId", "=", "projects.workspaceId")
        .on("workspaceMembers.userId", "=", userId),
    )
    .selectAll("bugs")
    .select(["projects.workspaceId", "workspaceMembers.role"])
    .where("bugs.id", "=", bugId)
    .executeTakeFirst()
  if (!row?.role) throw new ApiError("NOT_FOUND", "Bug not found")
  const { role: _role, ...bug } = row
  return bug
}

// Resolves a KEY-Bn identifier within one workspace; the caller checks membership first.
export async function findBugIdByKey(db: Db, workspaceId: string, key: string) {
  const [, projectKey, number] = BUG_KEY_PATTERN.exec(key) ?? []
  if (!projectKey || !number) return undefined
  const row = await db
    .selectFrom("bugs")
    .innerJoin("projects", "projects.id", "bugs.projectId")
    .select("bugs.id")
    .where("projects.workspaceId", "=", workspaceId)
    .where("projects.key", "=", projectKey.toUpperCase())
    .where("bugs.number", "=", Number(number))
    .executeTakeFirst()
  return row?.id
}

/**
 * Opens a task against a resolved bug: in the bug's project, tagged `bug` (the tag is created
 * if the workspace has none) and linked to the bug, which is pending again. Returns its id.
 */
export async function openRegression(
  db: Db,
  userId: string,
  bug: BugRow,
  input: RegressionTaskInput,
): Promise<string> {
  return inTransaction(db, async (trx) => {
    // Writing the bug first locks its row, so two regressions at once cannot both pass the check.
    await trx.updateTable("bugs").set({ updatedAt: now() }).where("id", "=", bug.id).execute()
    if (await isPending(trx, bug.id))
      throw new ApiError("CONFLICT", "Complete this bug's open task before opening another.")
    const project = await trx
      .selectFrom("projects")
      .selectAll()
      .where("id", "=", bug.projectId)
      .executeTakeFirstOrThrow()
    let tagId = await findBugTagId(trx, project.workspaceId)
    if (!tagId) {
      tagId = newId()
      await trx
        .insertInto("tags")
        .values({
          id: tagId,
          workspaceId: project.workspaceId,
          name: "bug",
          color: "orange",
          createdAt: now(),
        })
        .execute()
    }
    return createTask(
      trx,
      userId,
      project,
      {
        ...input,
        title: input.title ?? bug.title,
        body: input.body ?? null,
        tagIds: [...(input.tagIds ?? []), tagId],
      },
      bug.id,
    )
  })
}
