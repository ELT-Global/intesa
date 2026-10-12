import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { DAY_MS } from "../db"
import type { Deps } from "../deps"
import { validate } from "../lib/validate"
import { toProjectJson } from "../projects/service"
import { isRealDate } from "../tasks/schemas"
import { listAssignedTaskSummaries, listDueTaskSummaries, withProjects } from "../tasks/service"
import { loadWeekLog } from "../tasks/week"
import { requireMembership } from "../workspaces/membership"

// The client's local date, so "due soon" matches the day the person is looking at.
const homeQuery = z.object({
  today: z.string().refine(isRealDate, "Use a date as YYYY-MM-DD").optional(),
})

// The client turns its local week into two instants; the server never assumes a time zone.
// Eight days leaves room for a week that crosses a daylight-saving change.
const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString())
const weekQuery = z
  .object({ from: instant, to: instant })
  .refine((q) => q.to > q.from, { path: ["to"], message: "Must be after from" })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 8 * DAY_MS, {
    path: ["to"],
    message: "The range can be at most 8 days",
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
    .get("/:workspaceId/week", validate("query", weekQuery), async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireMembership(db, c.var.user.id, workspaceId)
      const { from, to } = c.req.valid("query")
      return c.json(await loadWeekLog(db, workspaceId, from, to))
    })
}
