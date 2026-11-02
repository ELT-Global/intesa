import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { newId, now } from "../db"
import type { Deps } from "../deps"
import { DEFAULT_MERGE_BRANCH, newSecret, workspaceWebhook } from "../github/settings"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"
import { requireMembership, requireOwner } from "../workspaces/membership"

// A branch name as git allows it, roughly: no spaces or the characters git refuses.
const mergeBranch = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\s~^:?*[\\]+$/, "Not a valid branch name")
const patchBody = z.object({
  mergeBranch: mergeBranch.optional(),
  // null removes the token; leaving it out keeps it.
  token: z.string().trim().min(1).max(500).nullable().optional(),
})

// A workspace's GitHub webhook. Members can see it; owners create, change and delete it. The
// secret is only ever returned when it is made, and the token never.
export function workspaceGithubRoutes({ db, config }: Deps) {
  const toJson = (hook: NonNullable<Awaited<ReturnType<typeof workspaceWebhook>>>) => ({
    url: `${config.publicUrl}/api/webhooks/github/${hook.hookId}`,
    mergeBranch: hook.mergeBranch,
    tokenSet: hook.token !== null,
    createdAt: hook.createdAt,
  })
  const load = async (workspaceId: string) => {
    const hook = await workspaceWebhook(db, workspaceId)
    return hook ? toJson(hook) : null
  }
  // After a write that leaves the workspace with a webhook.
  const saved = async (workspaceId: string) =>
    toJson(
      await db
        .selectFrom("githubWebhooks")
        .selectAll()
        .where("workspaceId", "=", workspaceId)
        .executeTakeFirstOrThrow(),
    )

  return (
    new Hono<AppEnv>()
      .use(requireUser(db))
      .get("/:workspaceId/github", async (c) => {
        const workspaceId = c.req.param("workspaceId")
        await requireMembership(db, c.var.user.id, workspaceId)
        return c.json({ github: await load(workspaceId) })
      })
      // Creates the webhook, or gives the existing one a new secret (its URL stays the same).
      .post("/:workspaceId/github", async (c) => {
        const workspaceId = c.req.param("workspaceId")
        await requireOwner(db, c.var.user.id, workspaceId)
        const secret = newSecret()
        const ts = now()
        const existing = await workspaceWebhook(db, workspaceId)
        if (existing) {
          await db
            .updateTable("githubWebhooks")
            .set({ secret, updatedAt: ts })
            .where("workspaceId", "=", workspaceId)
            .execute()
        } else {
          await db
            .insertInto("githubWebhooks")
            .values({
              workspaceId,
              hookId: newId(),
              secret,
              mergeBranch: DEFAULT_MERGE_BRANCH,
              token: null,
              createdAt: ts,
              updatedAt: ts,
            })
            .execute()
        }
        return c.json({ github: await saved(workspaceId), secret }, existing ? 200 : 201)
      })
      .patch("/:workspaceId/github", validate("json", patchBody), async (c) => {
        const workspaceId = c.req.param("workspaceId")
        await requireOwner(db, c.var.user.id, workspaceId)
        if (!(await workspaceWebhook(db, workspaceId))) {
          throw new ApiError("NOT_FOUND", "This workspace has no GitHub webhook")
        }
        const { mergeBranch, token } = c.req.valid("json")
        await db
          .updateTable("githubWebhooks")
          .set({
            ...(mergeBranch !== undefined && { mergeBranch }),
            ...(token !== undefined && { token }),
            updatedAt: now(),
          })
          .where("workspaceId", "=", workspaceId)
          .execute()
        return c.json({ github: await saved(workspaceId) })
      })
      // Pull requests already linked stay on their tasks.
      .delete("/:workspaceId/github", async (c) => {
        const workspaceId = c.req.param("workspaceId")
        await requireOwner(db, c.var.user.id, workspaceId)
        await db.deleteFrom("githubWebhooks").where("workspaceId", "=", workspaceId).execute()
        return c.body(null, 204)
      })
  )
}
