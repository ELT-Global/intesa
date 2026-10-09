import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"
import { searchTasks } from "../tasks/relationships"
import { findTaskIdByKey, loadTaskDetail } from "../tasks/service"
import { requireMembership } from "../workspaces/membership"

export function searchRoutes({ db }: Deps) {
  return (
    new Hono<AppEnv>()
      .use(requireUser(db))
      .get(
        "/:workspaceId/tasks/search",
        validate("query", z.object({ q: z.string().max(100).default("") })),
        async (c) => {
          const workspaceId = c.req.param("workspaceId")
          await requireMembership(db, c.var.user.id, workspaceId)
          return c.json({ tasks: await searchTasks(db, workspaceId, c.req.valid("query").q) })
        },
      )
      // Exact lookup by KEY-n (any case); subtasks included, unlike the project task lists.
      .get("/:workspaceId/tasks/by-key/:key", async (c) => {
        const workspaceId = c.req.param("workspaceId")
        await requireMembership(db, c.var.user.id, workspaceId)
        const taskId = await findTaskIdByKey(db, workspaceId, c.req.param("key"))
        if (!taskId) throw new ApiError("NOT_FOUND", "Task not found")
        return c.json({ task: await loadTaskDetail(db, taskId) })
      })
  )
}
