import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import type { Deps } from "../deps"
import { validate } from "../lib/validate"
import { addRelationship, RELATION_TYPES, removeRelationship } from "../tasks/relationships"
import { patchTaskBody } from "../tasks/schemas"
import {
  listHistory,
  loadTaskDetail,
  loadTaskSummaries,
  requireTask,
  updateTask,
} from "../tasks/service"

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
      await updateTask(db, c.var.user.id, task, c.req.valid("json"))
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
        await removeRelationship(db, task.id, c.req.valid("query").type, c.req.param("otherTaskId"))
        return c.json({ task: await loadTaskDetail(db, task.id) })
      },
    )
    .get("/:taskId/history", async (c) => {
      const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
      return c.json({ history: await listHistory(db, task.id) })
    })
}
