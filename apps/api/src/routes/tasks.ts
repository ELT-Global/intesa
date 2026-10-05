import { Hono } from "hono"
import { type AppEnv, requireUser } from "../auth/middleware"
import type { Deps } from "../deps"
import { validate } from "../lib/validate"
import { patchTaskBody } from "../tasks/schemas"
import {
  listHistory,
  loadTaskDetail,
  loadTaskSummaries,
  requireTask,
  updateTask,
} from "../tasks/service"

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
    .get("/:taskId/history", async (c) => {
      const { task } = await requireTask(db, c.var.user.id, c.req.param("taskId"))
      return c.json({ history: await listHistory(db, task.id) })
    })
}
