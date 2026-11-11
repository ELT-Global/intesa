import { type Db, newId, now } from "../db"
import type { BugStatus } from "./schemas"

// How task writes keep bugs in step: tagging a task `bug` opens a bug for it and untagging
// unlinks the task. Called inside the task write's transaction, so every caller is covered.

// The workspace's bug tag is the one named "bug", whatever its case.
export const BUG_TAG_NAME = "bug"

export const findBugTagId = async (db: Db, workspaceId: string) =>
  (
    await db
      .selectFrom("tags")
      .select("id")
      .where("workspaceId", "=", workspaceId)
      .where((eb) => eb(eb.fn("lower", ["name"]), "=", BUG_TAG_NAME))
      .executeTakeFirst()
  )?.id

export const bugKey = (projectKey: string, number: number) => `${projectKey}-B${number}`

type TaskRef = { id: string; projectId: string; title: string }

// The bug takes the task's title once; its description starts empty and is its own.
async function openBug(trx: Db, userId: string, task: TaskRef) {
  // The increment and the insert share a transaction, so numbers are gap-free and unique.
  const { bugCounter } = await trx
    .updateTable("projects")
    .set((eb) => ({ bugCounter: eb("bugCounter", "+", 1) }))
    .where("id", "=", task.projectId)
    .returning("bugCounter")
    .executeTakeFirstOrThrow()
  const id = newId()
  const ts = now()
  await trx
    .insertInto("bugs")
    .values({
      id,
      projectId: task.projectId,
      number: bugCounter,
      title: task.title,
      body: null,
      createdBy: userId,
      createdAt: ts,
      updatedAt: ts,
    })
    .execute()
  await trx.insertInto("bugTasks").values({ taskId: task.id, bugId: id, createdAt: ts }).execute()
}

/**
 * Links or unlinks the task after its tags were written. `bugId` links a newly tagged task to
 * that bug instead of opening one (a regression). Removing the tag unlinks the task, and a
 * trigger deletes a bug left without tasks.
 */
export async function syncTaskBug(trx: Db, userId: string, taskId: string, bugId?: string) {
  const task = await trx
    .selectFrom("tasks")
    .select(["id", "projectId", "title"])
    .where("id", "=", taskId)
    .executeTakeFirstOrThrow()
  const tagged = await trx
    .selectFrom("taskTags")
    .innerJoin("tags", "tags.id", "taskTags.tagId")
    .select("tags.id")
    .where("taskTags.taskId", "=", taskId)
    .where((eb) => eb(eb.fn("lower", ["tags.name"]), "=", BUG_TAG_NAME))
    .executeTakeFirst()
  const link = await trx
    .selectFrom("bugTasks")
    .select("bugId")
    .where("taskId", "=", taskId)
    .executeTakeFirst()
  if (!tagged) {
    if (link) await trx.deleteFrom("bugTasks").where("taskId", "=", taskId).execute()
  } else if (!link) {
    if (bugId) {
      await trx.insertInto("bugTasks").values({ taskId, bugId, createdAt: now() }).execute()
    } else {
      await openBug(trx, userId, task)
    }
  }
}

// A bug is pending while any of its tasks is not complete.
export const isPending = async (db: Db, bugId: string) =>
  Boolean(
    await db
      .selectFrom("bugTasks")
      .innerJoin("tasks", "tasks.id", "bugTasks.taskId")
      .select("tasks.id")
      .where("bugTasks.bugId", "=", bugId)
      .where("tasks.status", "!=", "complete")
      .executeTakeFirst(),
  )

export type BugRef = {
  id: string
  key: string
  title: string
  status: BugStatus
  /** Tasks opened after the first. */
  regressions: number
}

// The bug a task belongs to, for its detail.
export async function loadTaskBug(db: Db, taskId: string): Promise<BugRef | null> {
  const bug = await db
    .selectFrom("bugTasks")
    .innerJoin("bugs", "bugs.id", "bugTasks.bugId")
    .innerJoin("projects", "projects.id", "bugs.projectId")
    .select(["bugs.id", "bugs.number", "bugs.title", "projects.key"])
    .where("bugTasks.taskId", "=", taskId)
    .executeTakeFirst()
  if (!bug) return null
  const { tasks } = await db
    .selectFrom("bugTasks")
    .select((eb) => eb.fn.countAll<string>().as("tasks"))
    .where("bugId", "=", bug.id)
    .executeTakeFirstOrThrow()
  return {
    id: bug.id,
    key: bugKey(bug.key, bug.number),
    title: bug.title,
    status: (await isPending(db, bug.id)) ? "pending" : "resolved",
    regressions: Math.max(Number(tasks) - 1, 0),
  }
}
