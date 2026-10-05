import { type Db, inTransaction, isUniqueViolation, newId, now } from "../db"
import { ApiError } from "../lib/errors"
import type { Role } from "./membership"

export type MemberJson = {
  id: string
  userId: string
  name: string
  email: string
  avatarUrl: string | null
  role: Role
  createdAt: string
}

const memberQuery = (db: Db) =>
  db
    .selectFrom("workspaceMembers")
    .innerJoin("users", "users.id", "workspaceMembers.userId")
    .select([
      "workspaceMembers.id",
      "workspaceMembers.userId",
      "users.name",
      "users.email",
      "users.avatarUrl",
      "workspaceMembers.role",
      "workspaceMembers.createdAt",
    ])

export const listMembers = (db: Db, workspaceId: string): Promise<MemberJson[]> =>
  memberQuery(db)
    .where("workspaceMembers.workspaceId", "=", workspaceId)
    .orderBy("users.name")
    .orderBy("users.email")
    .execute()

// NOT_FOUND when the membership belongs to another workspace, so ids cannot be probed.
export async function requireMember(
  db: Db,
  workspaceId: string,
  memberId: string,
): Promise<MemberJson> {
  const member = await memberQuery(db)
    .where("workspaceMembers.workspaceId", "=", workspaceId)
    .where("workspaceMembers.id", "=", memberId)
    .executeTakeFirst()
  if (!member) throw new ApiError("NOT_FOUND", "Member not found")
  return member
}

const ownerCount = async (db: Db, workspaceId: string) => {
  const row = await db
    .selectFrom("workspaceMembers")
    .select((eb) => eb.fn.countAll().as("n"))
    .where("workspaceId", "=", workspaceId)
    .where("role", "=", "owner")
    .executeTakeFirstOrThrow()
  return Number(row.n)
}

export async function addMember(
  db: Db,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<string> {
  const id = newId()
  try {
    await db
      .insertInto("workspaceMembers")
      .values({ id, workspaceId, userId, role, createdAt: now() })
      .execute()
  } catch (err) {
    // The unique (workspace, user) constraint decides, so concurrent adds cannot both win.
    if (isUniqueViolation(err)) throw new ApiError("CONFLICT", "Already a member of this workspace")
    throw err
  }
  return id
}

export async function changeRole(
  db: Db,
  workspaceId: string,
  member: MemberJson,
  role: Role,
): Promise<void> {
  await inTransaction(db, async (trx) => {
    if (member.role === "owner" && role !== "owner" && (await ownerCount(trx, workspaceId)) <= 1) {
      throw new ApiError("CONFLICT", "A workspace needs at least one owner")
    }
    await trx.updateTable("workspaceMembers").set({ role }).where("id", "=", member.id).execute()
  })
}

// Removes the membership and the person's task assignments in this workspace only.
export async function removeMember(db: Db, workspaceId: string, member: MemberJson): Promise<void> {
  await inTransaction(db, async (trx) => {
    if (member.role === "owner" && (await ownerCount(trx, workspaceId)) <= 1) {
      throw new ApiError("CONFLICT", "A workspace needs at least one owner")
    }
    await trx
      .deleteFrom("taskAssignees")
      .where("userId", "=", member.userId)
      .where(
        "taskId",
        "in",
        trx.selectFrom("tasks").select("id").where("workspaceId", "=", workspaceId),
      )
      .execute()
    await trx.deleteFrom("workspaceMembers").where("id", "=", member.id).execute()
  })
}
