import { Hono } from "hono"
import { type AppEnv, requireUser } from "../auth/middleware"
import type { Deps } from "../deps"
import { toProjectJson } from "../projects/service"
import {
  listAssignedTaskIds,
  listDueTaskIds,
  loadTaskSummaries,
  withProjects,
} from "../tasks/service"
import { requireMembership } from "../workspaces/membership"

const DAY_MS = 24 * 60 * 60 * 1000

export function homeRoutes({ db }: Deps) {
  const load = async (ids: string[]) => withProjects(db, await loadTaskSummaries(db, ids))

  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/:workspaceId/my-tasks", async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireMembership(db, c.var.user.id, workspaceId)
      const ids = await listAssignedTaskIds(db, workspaceId, c.var.user.id)
      return c.json({ tasks: await load(ids) })
    })
    .get("/:workspaceId/home", async (c) => {
      const workspaceId = c.req.param("workspaceId")
      const userId = c.var.user.id
      await requireMembership(db, userId, workspaceId)
      const through = new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 10)

      const [projects, assignedIds, dueIds] = await Promise.all([
        db
          .selectFrom("projects")
          .selectAll()
          .where("workspaceId", "=", workspaceId)
          .orderBy("updatedAt", "desc")
          .limit(5)
          .execute(),
        listAssignedTaskIds(db, workspaceId, userId, { excludeComplete: true, limit: 10 }),
        listDueTaskIds(db, workspaceId, through, 10),
      ])
      return c.json({
        projects: projects.map(toProjectJson),
        assigned: await load(assignedIds),
        dueSoon: await load(dueIds),
      })
    })
}
