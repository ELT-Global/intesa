import { randomBytes } from "node:crypto"
import type { Db } from "../db"

// Status changes made by the webhook are recorded as this user (created by the 0009 migration).
export const GITHUB_USER_ID = "github"

export const DEFAULT_MERGE_BRANCH = "qa"
export const DEFAULT_PRODUCTION_BRANCH = "main"

// Shared with GitHub to sign deliveries, so it is kept as it is (it cannot be hashed) and shown
// only when it is made.
export const newSecret = () => randomBytes(24).toString("hex")

export const workspaceWebhook = (db: Db, workspaceId: string) =>
  db
    .selectFrom("githubWebhooks")
    .selectAll()
    .where("workspaceId", "=", workspaceId)
    .executeTakeFirst()
