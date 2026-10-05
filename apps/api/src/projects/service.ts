import type { Selectable } from "kysely"
import { type Db, newId, now } from "../db"
import type { ProjectTable } from "../db/schema"
import { ApiError } from "../lib/errors"
import { type Role, requireMembership } from "../workspaces/membership"

export type ProjectRow = Selectable<ProjectTable>

export type ProjectJson = {
  id: string
  workspaceId: string
  name: string
  key: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export const toProjectJson = (p: ProjectRow): ProjectJson => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  key: p.key,
  description: p.description,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
})

export const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,4}$/

// Initials of the words ("Website Redesign" -> WR); a single word uses its leading
// letters. Always 2-5 characters starting with a letter.
export function deriveKeyBase(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? []
  const letters = words.join("").replace(/[^A-Z]/g, "")
  let key =
    words.length > 1
      ? words
          .map((w) => w[0])
          .join("")
          .slice(0, 5)
      : (words[0] ?? "").slice(0, 3)
  if (!/^[A-Z]/.test(key)) key = letters.slice(0, 3)
  if (key.length < 2) key = (key + letters).slice(0, 3)
  if (key.length < 2) key = "PRJ"
  return key
}

const keyExists = async (db: Db, workspaceId: string, key: string) =>
  (await db
    .selectFrom("projects")
    .select("id")
    .where("workspaceId", "=", workspaceId)
    .where("key", "=", key)
    .executeTakeFirst()) !== undefined

async function uniqueKey(db: Db, workspaceId: string, base: string): Promise<string> {
  if (!(await keyExists(db, workspaceId, base))) return base
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n)
    const candidate = base.slice(0, 5 - suffix.length) + suffix
    if (!(await keyExists(db, workspaceId, candidate))) return candidate
  }
  throw new ApiError("CONFLICT", "Could not derive a unique project key")
}

export async function createProject(
  db: Db,
  workspaceId: string,
  input: { name: string; key?: string; description?: string | null },
): Promise<ProjectRow> {
  const conflict = new ApiError("CONFLICT", "That project key is already in use")
  if (input.key && (await keyExists(db, workspaceId, input.key))) throw conflict
  const key = input.key ?? (await uniqueKey(db, workspaceId, deriveKeyBase(input.name)))

  const ts = now()
  try {
    return await db
      .insertInto("projects")
      .values({
        id: newId(),
        workspaceId,
        name: input.name,
        key,
        description: input.description ?? null,
        taskCounter: 0,
        createdAt: ts,
        updatedAt: ts,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  } catch (err) {
    // A concurrent request may have claimed the key after the check above.
    if (await keyExists(db, workspaceId, key)) throw conflict
    throw err
  }
}

// Authorization for project-scoped routes: the caller must belong to the project's
// workspace. Anything else is NOT_FOUND so other workspaces look the same as missing ones.
export async function requireProject(
  db: Db,
  userId: string,
  projectId: string,
): Promise<{ project: ProjectRow; role: Role }> {
  const project = await db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", projectId)
    .executeTakeFirst()
  if (!project) throw new ApiError("NOT_FOUND", "Project not found")
  const role = await requireMembership(db, userId, project.workspaceId).catch(() => {
    throw new ApiError("NOT_FOUND", "Project not found")
  })
  return { project, role }
}
