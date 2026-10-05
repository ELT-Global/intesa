import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import type { Deps } from "../deps"
import { validate } from "../lib/validate"
import { requireProject } from "../projects/service"
import {
  createField,
  FIELD_TYPES,
  listFields,
  requireField,
  updateField,
} from "../tasks/custom-fields"

const name = z.string().trim().min(1).max(60)
const options = z.array(z.string().trim().min(1).max(60)).max(50)
const uniqueOptions = options.refine((o) => new Set(o).size === o.length, "Options must be unique")

const createBody = z.object({
  name,
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  options: uniqueOptions.optional(),
})
const patchBody = z.object({
  name: name.optional(),
  required: z.boolean().optional(),
  options: uniqueOptions.optional(),
})

export function projectFieldRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/:projectId/custom-fields", async (c) => {
      const { project } = await requireProject(db, c.var.user.id, c.req.param("projectId"))
      return c.json({ fields: await listFields(db, project.id) })
    })
    .post("/:projectId/custom-fields", validate("json", createBody), async (c) => {
      const { project } = await requireProject(db, c.var.user.id, c.req.param("projectId"))
      return c.json({ field: await createField(db, project.id, c.req.valid("json")) }, 201)
    })
}

export function fieldRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .use(requireUser(db))
    .patch("/:fieldId", validate("json", patchBody), async (c) => {
      const field = await requireField(db, c.var.user.id, c.req.param("fieldId"))
      return c.json({ field: await updateField(db, field, c.req.valid("json")) })
    })
    .delete("/:fieldId", async (c) => {
      const field = await requireField(db, c.var.user.id, c.req.param("fieldId"))
      // Stored values go with the definition through the foreign key cascade.
      await db.deleteFrom("customFieldDefinitions").where("id", "=", field.id).execute()
      return c.body(null, 204)
    })
}
