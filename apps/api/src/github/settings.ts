import { randomBytes } from "node:crypto"
import type { Db } from "../db"
import { ApiError } from "../lib/errors"
import { requireMembership } from "../workspaces/membership"

// Status changes made by the webhook are recorded as this user (created by the 0009 migration).
export const GITHUB_USER_ID = "github"

export const DEFAULT_MERGE_BRANCH = "qa"

// Shared with GitHub to sign deliveries, so it is kept as it is (it cannot be hashed) and shown
// only when it is made.
export const newSecret = () => randomBytes(24).toString("hex")

export const workspaceWebhook = (db: Db, workspaceId: string) =>
  db
    .selectFrom("githubWebhooks")
    .selectAll()
    .where("workspaceId", "=", workspaceId)
    .executeTakeFirst()

export async function requireOwner(db: Db, userId: string, workspaceId: string) {
  if ((await requireMembership(db, userId, workspaceId)) !== "owner") {
    throw new ApiError("FORBIDDEN", "Only workspace owners can do this")
  }
}
