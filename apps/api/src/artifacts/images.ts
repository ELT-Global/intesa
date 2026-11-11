import type { Db } from "../db"

// The ids of this task's artifacts that some Markdown links to, by relative or absolute URL.
function linkedArtifactIds(taskId: string, markdown: string | null) {
  const ids = new Set<string>()
  if (!markdown) return ids
  const prefix = `/api/tasks/${encodeURIComponent(taskId)}/artifacts/`
  for (let at = markdown.indexOf(prefix); at !== -1; at = markdown.indexOf(prefix, at + 1)) {
    const id = /^[\w-]+/.exec(markdown.slice(at + prefix.length))?.[0]
    if (id) ids.add(id)
  }
  return ids
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
  const kept = linkedArtifactIds(taskId, nextBody)
  const dropped = [...linkedArtifactIds(taskId, body)].filter((id) => !kept.has(id))
  if (!dropped.length) return
  await trx
    .deleteFrom("artifacts")
    .where("taskId", "=", taskId)
    .where("id", "in", dropped)
    .where("mimeType", "like", "image/%")
    .execute()
}
