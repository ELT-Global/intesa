import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import type { Deps } from "../deps"
import { validate } from "../lib/validate"
import { searchTasks } from "../tasks/relationships"
import { requireMembership } from "../workspaces/membership"

export function searchRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
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
}
