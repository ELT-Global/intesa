import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { isUniqueViolation, newId, now } from "../db"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"
import { requireMembership } from "../workspaces/membership"

export const TAG_COLORS = ["blue", "orange", "aqua", "violet", "magenta", "gray"] as const

const name = z.string().trim().min(1).max(40)
const color = z.enum(TAG_COLORS)
const createBody = z.object({ name, color: color.optional() })
const patchBody = z.object({ name: name.optional(), color: color.optional() })

type TagRow = { id: string; name: string; color: string }
const toJson = (t: TagRow) => ({ id: t.id, name: t.name, color: t.color })

// Names are unique per workspace regardless of case (a unique index on lower(name)).
async function orConflict<T>(write: Promise<T>): Promise<T> {
  try {
    return await write
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ApiError("CONFLICT", "A tag with that name already exists")
    throw err
  }
}

export function workspaceTagRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/:workspaceId/tags", async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireMembership(db, c.var.user.id, workspaceId)
      const tags = await db
        .selectFrom("tags")
        .select(["id", "name", "color"])
        .where("workspaceId", "=", workspaceId)
        .orderBy("name")
        .execute()
      return c.json({ tags })
    })
    .post("/:workspaceId/tags", validate("json", createBody), async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireMembership(db, c.var.user.id, workspaceId)
      const body = c.req.valid("json")
      // The default cycles through the palette so neighbouring tags look different.
      const { n } = await db
        .selectFrom("tags")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("workspaceId", "=", workspaceId)
        .executeTakeFirstOrThrow()
      // Uniqueness (case-insensitive) is enforced by an index; a clash surfaces as a violation.
      const tag = await orConflict(
        db
          .insertInto("tags")
          .values({
            id: newId(),
            workspaceId,
            name: body.name,
            color: body.color ?? TAG_COLORS[Number(n) % TAG_COLORS.length] ?? "blue",
            createdAt: now(),
          })
          .returning(["id", "name", "color"])
          .executeTakeFirstOrThrow(),
      )
      return c.json({ tag: toJson(tag) }, 201)
    })
}

export function tagRoutes({ db }: Deps) {
  // Outsiders get NOT_FOUND, same as a missing tag.
  const requireTag = async (userId: string, tagId: string) => {
    const row = await db
      .selectFrom("tags")
      .leftJoin("workspaceMembers", (join) =>
        join
          .onRef("workspaceMembers.workspaceId", "=", "tags.workspaceId")
          .on("workspaceMembers.userId", "=", userId),
      )
      .selectAll("tags")
      .select("workspaceMembers.role")
      .where("tags.id", "=", tagId)
      .executeTakeFirst()
    if (!row?.role) throw new ApiError("NOT_FOUND", "Tag not found")
    const { role: _role, ...tag } = row
    return tag
  }

  return new Hono<AppEnv>()
    .use(requireUser(db))
    .patch("/:tagId", validate("json", patchBody), async (c) => {
      const tag = await requireTag(c.var.user.id, c.req.param("tagId"))
      const patch = c.req.valid("json")
      const updated = await orConflict(
        db
          .updateTable("tags")
          .set({
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.color !== undefined && { color: patch.color }),
          })
          .where("id", "=", tag.id)
          .returning(["id", "name", "color"])
          .executeTakeFirstOrThrow(),
      )
      return c.json({ tag: toJson(updated) })
    })
    .delete("/:tagId", async (c) => {
      const tag = await requireTag(c.var.user.id, c.req.param("tagId"))
      // task_tags rows go with it through the foreign key cascade.
      await db.deleteFrom("tags").where("id", "=", tag.id).execute()
      return c.body(null, 204)
    })
}
