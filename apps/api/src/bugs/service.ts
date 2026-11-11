import type { Selectable } from "kysely"
import { type Db, inTransaction, newId, now } from "../db"
import type { BugTable } from "../db/schema"
import { ApiError } from "../lib/errors"
import type { Status } from "../tasks/schemas"
import { createTask } from "../tasks/service"
import { bugKey, findBugTagId, isPending } from "./links"
import { BUG_KEY_PATTERN, type BugStatus, type RegressionTaskInput } from "./schemas"

export type BugTask = { id: string; key: string; title: string; status: Status; createdAt: string }

export type BugSummary = {
  id: string
  projectId: string
  number: number
  key: string
  title: string
  status: BugStatus
  /** Oldest link first; `createdAt` is when the task joined the bug. */
  tasks: BugTask[]
  /** Still following its first task, until the bug itself is edited. */
  mirroring: boolean
  createdAt: string
  updatedAt: string
}

export type BugDetail = BugSummary & { body: string | null }

type BugScope = { ids: string[] } | { projectId: string }

const scopedIds = (db: Db, scope: BugScope) => {
  const q = db.selectFrom("bugs").select("bugs.id")
  return "ids" in scope
    ? q.where("bugs.id", "in", scope.ids)
    : q.where("bugs.projectId", "=", scope.projectId)
}

// Two queries however many bugs match: the bugs, and the tasks linked to them. Pending bugs
// come first, then the newest.
async function loadBugs(db: Db, scope: BugScope): Promise<BugDetail[]> {
  if ("ids" in scope && scope.ids.length === 0) return []
  const [bugs, links] = await Promise.all([
    db
      .selectFrom("bugs")
      .innerJoin("projects", "projects.id", "bugs.projectId")
      .select([
        "bugs.id",
        "bugs.projectId",
        "bugs.number",
        "bugs.title",
        "bugs.body",
        "bugs.editedAt",
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
        "projects.key",
      ])
      .where("bugTasks.bugId", "in", scopedIds(db, scope))
      .orderBy("bugTasks.createdAt")
      .orderBy("tasks.number")
      .execute(),
  ])

  const tasksByBug = new Map<string, BugTask[]>()
  for (const link of links) {
    const task: BugTask = {
      id: link.id,
      key: `${link.key}-${link.number}`,
      title: link.title,
      status: link.status as Status,
      createdAt: link.createdAt,
    }
    tasksByBug.set(link.bugId, [...(tasksByBug.get(link.bugId) ?? []), task])
  }

  return bugs
    .map((bug): BugDetail => {
      const tasks = tasksByBug.get(bug.id) ?? []
      return {
        id: bug.id,
        projectId: bug.projectId,
        number: bug.number,
        key: bugKey(bug.projectKey, bug.number),
        title: bug.title,
        status: tasks.some((t) => t.status !== "complete") ? "pending" : "resolved",
        tasks,
        mirroring: bug.editedAt === null,
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
    .map(({ body: _body, ...summary }) => summary)
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
