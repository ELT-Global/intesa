import { type Db, newId, now } from "../db"
import type { User } from "./session"

export type UserJson = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  totpEnabled: boolean
}

export const toUserJson = (u: User): UserJson => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarUrl: u.avatarUrl,
  totpEnabled: u.totpEnabled === 1,
})

export async function findOrCreateUser(
  db: Db,
  input: { email: string; name?: string; avatarUrl?: string | null; googleSub?: string },
): Promise<User> {
  const email = input.email.trim().toLowerCase()

  // Google identity wins; otherwise fall back to email so users invited by email
  // before their first sign-in are linked to the same account.
  if (input.googleSub) {
    const bySub = await db
      .selectFrom("users")
      .selectAll()
      .where("googleSub", "=", input.googleSub)
      .executeTakeFirst()
    if (bySub) return bySub
  }

  const byEmail = await db
    .selectFrom("users")
    .selectAll()
    .where("email", "=", email)
    .executeTakeFirst()
  if (byEmail) {
    if (input.googleSub && !byEmail.googleSub) {
      return db
        .updateTable("users")
        .set({
          googleSub: input.googleSub,
          avatarUrl: byEmail.avatarUrl ?? input.avatarUrl ?? null,
          updatedAt: now(),
        })
        .where("id", "=", byEmail.id)
        .returningAll()
        .executeTakeFirstOrThrow()
    }
    return byEmail
  }

  const ts = now()
  return db
    .insertInto("users")
    .values({
      id: newId(),
      name: input.name?.trim() || email.split("@")[0] || email,
      email,
      avatarUrl: input.avatarUrl ?? null,
      googleSub: input.googleSub ?? null,
      totpEnabled: 0,
      createdAt: ts,
      updatedAt: ts,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}
