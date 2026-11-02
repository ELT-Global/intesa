import type { Db } from "../db"
import { ApiError } from "../lib/errors"

export type Role = "owner" | "member"

// Resolves the caller's role in a workspace. Non-members get NOT_FOUND (never FORBIDDEN)
// so the existence of other workspaces is not revealed.
export async function requireMembership(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<Role> {
  const row = await db
    .selectFrom("workspaceMembers")
    .select("role")
    .where("workspaceId", "=", workspaceId)
    .where("userId", "=", userId)
    .executeTakeFirst()
  if (!row) throw new ApiError("NOT_FOUND", "Workspace not found")
  return row.role
}

// For routes only owners may use, given the caller's role in the workspace.
export function assertOwner(role: Role) {
  if (role !== "owner") throw new ApiError("FORBIDDEN", "Only workspace owners can do this")
}

export async function requireOwner(db: Db, userId: string, workspaceId: string) {
  assertOwner(await requireMembership(db, userId, workspaceId))
}
