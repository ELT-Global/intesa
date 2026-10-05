import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import type { Deps } from "../deps"
import { validate } from "../lib/validate"
import { toProjectJson } from "../projects/service"
import { isRealDate } from "../tasks/schemas"
import { listAssignedTaskSummaries, listDueTaskSummaries, withProjects } from "../tasks/service"
import { requireMembership } from "../workspaces/membership"

const DAY_MS = 24 * 60 * 60 * 1000

// The client's local date, so "due soon" matches the day the person is looking at.
const homeQuery = z.object({
  today: z.string().refine(isRealDate, "Use a date as YYYY-MM-DD").optional(),
})

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

export function homeRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/:workspaceId/my-tasks", async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireMembership(db, c.var.user.id, workspaceId)
      const tasks = await listAssignedTaskSummaries(db, workspaceId, c.var.user.id)
      return c.json({ tasks: await withProjects(db, tasks) })
    })
    .get("/:workspaceId/home", validate("query", homeQuery), async (c) => {
      const workspaceId = c.req.param("workspaceId")
      const userId = c.var.user.id
      await requireMembership(db, userId, workspaceId)
      const today = c.req.valid("query").today ?? new Date().toISOString().slice(0, 10)

      const [projects, assigned, dueSoon] = await Promise.all([
        db
          .selectFrom("projects")
          .selectAll()
          .where("workspaceId", "=", workspaceId)
          .orderBy("updatedAt", "desc")
          .limit(5)
          .execute(),
        listAssignedTaskSummaries(db, workspaceId, userId, { excludeComplete: true, limit: 10 }),
        listDueTaskSummaries(db, workspaceId, plusDays(today, 7), 10),
      ])
      return c.json({
        projects: projects.map(toProjectJson),
        assigned: await withProjects(db, assigned),
        dueSoon: await withProjects(db, dueSoon),
      })
    })
}
