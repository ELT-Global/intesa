import type { Insertable } from "kysely"
import { artifactPath, bugImagePath, linkedIds } from "../artifacts/images"
import { type Db, newId, now } from "../db"
import type { BugImageTable } from "../db/schema"
import type { BugStatus } from "./schemas"

// How task writes keep bugs in step: tagging a task `bug` opens a bug for it, the bug copies
// its first task until the bug is edited, and untagging unlinks the task. Called inside the
// task write's transaction, so every caller (routes, GitHub webhook moves) is covered.

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

type TaskContent = { id: string; projectId: string; title: string; body: string | null }

/**
 * The bug's own copy of a task body. Task artifacts die when the task's description drops
 * them, so each image the body shows gets a bug image on the same blob (no bytes are copied)
 * and its link is pointed there. Links to documents are left as they are.
 */
async function copyBody(trx: Db, bugId: string, task: TaskContent) {
  const path = artifactPath(task.id)
  const ids = [...linkedIds(path, task.body)]
  if (!task.body || !ids.length) return { body: task.body, images: [] }
  const artifacts = await trx
    .selectFrom("artifacts")
    .select(["id", "name", "mimeType", "size", "blobHash"])
    .where("taskId", "=", task.id)
    .where("id", "in", ids)
    .where("mimeType", "like", "image/%")
    .execute()
  const createdAt = now()
  const imageIds = new Map<string, string>()
  const images: Insertable<BugImageTable>[] = artifacts.map(({ id, ...artifact }) => {
    const image = { id: newId(), bugId, ...artifact, createdAt }
    imageIds.set(id, image.id)
    return image
  })
  const [head, ...rest] = task.body.split(path)
  const body = [
    head,
    ...rest.map((part) => {
      const artifactId = /^[\w-]+/.exec(part)?.[0] ?? ""
      const imageId = imageIds.get(artifactId)
      return imageId ? bugImagePath(bugId) + imageId + part.slice(artifactId.length) : path + part
    }),
  ].join("")
  return { body, images }
}

async function openBug(trx: Db, userId: string, task: TaskContent) {
  // The increment and the insert share a transaction, so numbers are gap-free and unique.
  const { bugCounter } = await trx
    .updateTable("projects")
    .set((eb) => ({ bugCounter: eb("bugCounter", "+", 1) }))
    .where("id", "=", task.projectId)
    .returning("bugCounter")
    .executeTakeFirstOrThrow()
  const id = newId()
  const ts = now()
  const { body, images } = await copyBody(trx, id, task)
  await trx
    .insertInto("bugs")
    .values({
      id,
      projectId: task.projectId,
      number: bugCounter,
      title: task.title,
      body,
      sourceTaskId: task.id,
      editedAt: null,
      createdBy: userId,
      createdAt: ts,
      updatedAt: ts,
    })
    .execute()
  if (images.length) await trx.insertInto("bugImages").values(images).execute()
  await trx.insertInto("bugTasks").values({ taskId: task.id, bugId: id, createdAt: ts }).execute()
}

// Copies the task into its bug again, while the bug still follows it. The new image handles
// go in before the old ones go, so blobs both bodies show are never released in between.
async function mirror(trx: Db, bugId: string, task: TaskContent) {
  const bug = await trx
    .selectFrom("bugs")
    .select(["sourceTaskId", "editedAt"])
    .where("id", "=", bugId)
    .executeTakeFirstOrThrow()
  if (bug.editedAt || bug.sourceTaskId !== task.id) return
  const old = await trx.selectFrom("bugImages").select("id").where("bugId", "=", bugId).execute()
  const { body, images } = await copyBody(trx, bugId, task)
  if (images.length) await trx.insertInto("bugImages").values(images).execute()
  await trx
    .updateTable("bugs")
    .set({ title: task.title, body, updatedAt: now() })
    .where("id", "=", bugId)
    .execute()
  if (old.length) {
    await trx
      .deleteFrom("bugImages")
      .where(
        "id",
        "in",
        old.map((i) => i.id),
      )
      .execute()
  }
}

/**
 * Brings the task's bug in line with the task as just written. `bugId` links a newly tagged
 * task to that bug instead of opening one (a regression); `mirror` says the title or body
 * changed. Removing the tag unlinks the task, and a trigger deletes a bug left without tasks.
 */
export async function syncTaskBug(
  trx: Db,
  userId: string,
  taskId: string,
  { bugId, mirror: contentChanged = false }: { bugId?: string; mirror?: boolean } = {},
) {
  const task = await trx
    .selectFrom("tasks")
    .select(["id", "projectId", "title", "body"])
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
  } else if (contentChanged) {
    await mirror(trx, link.bugId, task)
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

export type BugRef = { id: string; key: string; title: string; status: BugStatus }

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
  return {
    id: bug.id,
    key: bugKey(bug.key, bug.number),
    title: bug.title,
    status: (await isPending(db, bug.id)) ? "pending" : "resolved",
  }
}
