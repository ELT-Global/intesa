import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { now } from "../db"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"
import { createProject, KEY_PATTERN, requireProject, toProjectJson } from "../projects/service"
import { createTaskBody } from "../tasks/schemas"
import { createTask, listProjectTaskSummaries, loadTaskSummaries } from "../tasks/service"
import { requireMembership } from "../workspaces/membership"

const name = z.string().trim().min(1).max(80)
const description = z.string().trim().max(2000)

const createBody = z.object({
  name,
  key: z
    .string()
    .regex(KEY_PATTERN, "Key must be 2-5 characters (A-Z, 0-9) starting with a letter")
    .optional(),
  description: description.nullish(),
})
const patchBody = z.object({
  name: name.optional(),
  description: description.nullable().optional(),
})

// Collection routes live under the workspace.
export function workspaceProjectRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/:workspaceId/projects", async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireMembership(db, c.var.user.id, workspaceId)
      const rows = await db
        .selectFrom("projects")
        .selectAll()
        .where("workspaceId", "=", workspaceId)
        .orderBy("name")
        .execute()
      return c.json({ projects: rows.map(toProjectJson) })
    })
    .post("/:workspaceId/projects", validate("json", createBody), async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireMembership(db, c.var.user.id, workspaceId)
      const project = await createProject(db, workspaceId, c.req.valid("json"))
      return c.json({ project: toProjectJson(project) }, 201)
    })
}

export function projectRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/:projectId", async (c) => {
      const { project } = await requireProject(db, c.var.user.id, c.req.param("projectId"))
      return c.json({ project: toProjectJson(project) })
    })
    .patch("/:projectId", validate("json", patchBody), async (c) => {
      const { project } = await requireProject(db, c.var.user.id, c.req.param("projectId"))
      const patch = c.req.valid("json")
      const updated = await db
        .updateTable("projects")
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.description !== undefined && { description: patch.description }),
          updatedAt: now(),
        })
        .where("id", "=", project.id)
        .returningAll()
        .executeTakeFirstOrThrow()
      return c.json({ project: toProjectJson(updated) })
    })
    .delete("/:projectId", async (c) => {
      const { project, role } = await requireProject(db, c.var.user.id, c.req.param("projectId"))
      if (role !== "owner") throw new ApiError("FORBIDDEN", "Only workspace owners can do this")
      await db.deleteFrom("projects").where("id", "=", project.id).execute()
      return c.body(null, 204)
    })
    .get("/:projectId/tasks", async (c) => {
      const { project } = await requireProject(db, c.var.user.id, c.req.param("projectId"))
      return c.json({ tasks: await listProjectTaskSummaries(db, project.id) })
    })
    .post("/:projectId/tasks", validate("json", createTaskBody), async (c) => {
      const { project } = await requireProject(db, c.var.user.id, c.req.param("projectId"))
      const id = await createTask(db, c.var.user.id, project, c.req.valid("json"))
      const [task] = await loadTaskSummaries(db, [id])
      return c.json({ task: task as NonNullable<typeof task> }, 201)
    })
}
