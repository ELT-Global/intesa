import type { Db } from "../db"

export const artifactPath = (taskId: string) =>
  `/api/tasks/${encodeURIComponent(taskId)}/artifacts/`
export const bugImagePath = (bugId: string) => `/api/bugs/${encodeURIComponent(bugId)}/images/`

// The ids after `path` that some Markdown links to, by relative or absolute URL.
export function linkedIds(path: string, markdown: string | null) {
  const ids = new Set<string>()
  if (!markdown) return ids
  for (let at = markdown.indexOf(path); at !== -1; at = markdown.indexOf(path, at + 1)) {
    const id = /^[\w-]+/.exec(markdown.slice(at + path.length))?.[0]
    if (id) ids.add(id)
  }
  return ids
}

const dropped = (path: string, body: string | null, nextBody: string | null) => {
  const kept = linkedIds(path, nextBody)
  return [...linkedIds(path, body)].filter((id) => !kept.has(id))
}

/**
 * Deletes the images that the task's current description shows and `nextBody` no longer does,
 * so a screenshot removed from a description does not stay stored. Only images go: a document
 * linked from the description is still listed under Artifacts.
 */
export async function deleteDroppedImages(trx: Db, taskId: string, nextBody: string | null) {
  const { body } = await trx
    .selectFrom("tasks")
    .select("body")
    .where("id", "=", taskId)
    .executeTakeFirstOrThrow()
  const ids = dropped(artifactPath(taskId), body, nextBody)
  if (!ids.length) return
  await trx
    .deleteFrom("artifacts")
    .where("taskId", "=", taskId)
    .where("id", "in", ids)
    .where("mimeType", "like", "image/%")
    .execute()
}

// The same for a bug's description, whose images exist only to be shown there.
export async function deleteDroppedBugImages(trx: Db, bugId: string, nextBody: string | null) {
  const { body } = await trx
    .selectFrom("bugs")
    .select("body")
    .where("id", "=", bugId)
    .executeTakeFirstOrThrow()
  const ids = dropped(bugImagePath(bugId), body, nextBody)
  if (!ids.length) return
  await trx.deleteFrom("bugImages").where("bugId", "=", bugId).where("id", "in", ids).execute()
}
