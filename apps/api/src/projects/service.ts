import type { Selectable } from "kysely"
import { type Db, isUniqueViolation, newId, now } from "../db"
import type { ProjectTable } from "../db/schema"
import { ApiError } from "../lib/errors"
import type { Role } from "../workspaces/membership"

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

// Candidate keys in preference order: the base, then base with a numeric suffix (WS2, WS3...).
function* keyCandidates(base: string) {
  yield base
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n)
    yield base.slice(0, 5 - suffix.length) + suffix
  }
}

export async function createProject(
  db: Db,
  workspaceId: string,
  input: { name: string; key?: string; description?: string | null },
): Promise<ProjectRow> {
  const insert = (key: string) => {
    const ts = now()
    return db
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
  }

  // The unique (workspace, key) constraint is the only arbiter, so concurrent creates cannot
  // both win: an explicit key that loses is a conflict, a derived key moves to the next suffix.
  if (input.key) {
    try {
      return await insert(input.key)
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ApiError("CONFLICT", "That project key is already in use")
      throw err
    }
  }
  for (const key of keyCandidates(deriveKeyBase(input.name))) {
    try {
      return await insert(key)
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
    }
  }
  throw new ApiError("CONFLICT", "Could not derive a unique project key")
}

// Authorization for project-scoped routes: the caller must belong to the project's
// workspace. Anything else is NOT_FOUND so other workspaces look the same as missing ones.
export async function requireProject(
  db: Db,
  userId: string,
  projectId: string,
): Promise<{ project: ProjectRow; role: Role }> {
  const row = await db
    .selectFrom("projects")
    .leftJoin("workspaceMembers", (join) =>
      join
        .onRef("workspaceMembers.workspaceId", "=", "projects.workspaceId")
        .on("workspaceMembers.userId", "=", userId),
    )
    .selectAll("projects")
    .select("workspaceMembers.role")
    .where("projects.id", "=", projectId)
    .executeTakeFirst()
  if (!row?.role) throw new ApiError("NOT_FOUND", "Project not found")
  const { role, ...project } = row
  return { project, role }
}
