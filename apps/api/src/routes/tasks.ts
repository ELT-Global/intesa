import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { inTransaction } from "../db"
import type { Deps } from "../deps"
import { linkPullRequest, resolvePullRequest } from "../github/links"
import { validate } from "../lib/validate"
import { addRelationship, removeRelationship } from "../tasks/relationships"
import { patchTaskBody, RELATION_TYPES } from "../tasks/schemas"
import {
  listHistory,
  loadTaskDetail,
  loadTaskSummaries,
  requireTask,
  updateTask,
} from "../tasks/service"
import { artifactRoutes } from "./artifacts"

const relationBody = z.object({ type: z.enum(RELATION_TYPES), taskId: z.string().min(1) })

export function taskRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/:taskId", async (c) => {
      const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
      return c.json({ task: await loadTaskDetail(db, task.id) })
    })
    .patch("/:taskId", validate("json", patchTaskBody), async (c) => {
      const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
      const patch = c.req.valid("json")
      // GitHub is asked before the transaction, so a slow answer never holds the database.
      const pr = patch.pullRequest
        ? await resolvePullRequest(db, task.workspaceId, patch.pullRequest)
        : undefined
      await inTransaction(db, async (trx) => {
        await updateTask(trx, c.var.user.id, task, patch)
        // Before linking, so unlinking a PR and linking it again leaves it linked.
        if (patch.unlinkPullRequestId) {
          await trx
            .deleteFrom("taskPullRequests")
            .where("taskId", "=", task.id)
            .where("id", "=", patch.unlinkPullRequestId)
            .execute()
        }
        if (pr) await linkPullRequest(trx, task, pr, "manual", c.var.user.id)
      })
      const [summary] = await loadTaskSummaries(db, [task.id])
      return c.json({ task: summary as NonNullable<typeof summary> })
    })
    .delete("/:taskId", async (c) => {
      const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
      await db.deleteFrom("tasks").where("id", "=", task.id).execute()
      return c.body(null, 204)
    })
    .post("/:taskId/relationships", validate("json", relationBody), async (c) => {
      const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
      const { type, taskId } = c.req.valid("json")
      await addRelationship(db, task, type, taskId)
      return c.json({ task: await loadTaskDetail(db, task.id) }, 201)
    })
    .delete(
      "/:taskId/relationships/:otherTaskId",
      validate("query", z.object({ type: z.enum(RELATION_TYPES) })),
      async (c) => {
        const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
        await removeRelationship(db, task, c.req.valid("query").type, c.req.param("otherTaskId"))
        return c.json({ task: await loadTaskDetail(db, task.id) })
      },
    )
    .delete("/:taskId/pull-requests/:pullRequestId", async (c) => {
      const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
      // Unlinking never changes the task's status.
      await db
        .deleteFrom("taskPullRequests")
        .where("taskId", "=", task.id)
        .where("id", "=", c.req.param("pullRequestId"))
        .execute()
      return c.json({ task: await loadTaskDetail(db, task.id) })
    })
    .get("/:taskId/history", async (c) => {
      const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
      return c.json({ history: await listHistory(db, task.id) })
    })
    .route("/", artifactRoutes({ db }))
}
