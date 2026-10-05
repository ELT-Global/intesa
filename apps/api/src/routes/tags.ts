import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { type Db, newId, now } from "../db"
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

async function nameTaken(db: Db, workspaceId: string, tagName: string, exceptId?: string) {
  const rows = await db
    .selectFrom("tags")
    .select(["id", "name"])
    .where("workspaceId", "=", workspaceId)
    .execute()
  const wanted = tagName.toLowerCase()
  return rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === wanted)
}

const conflict = () => new ApiError("CONFLICT", "A tag with that name already exists")

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
      if (await nameTaken(db, workspaceId, body.name)) throw conflict()

      // The default cycles through the palette so neighbouring tags look different.
      const { n } = await db
        .selectFrom("tags")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("workspaceId", "=", workspaceId)
        .executeTakeFirstOrThrow()
      const tag = await db
        .insertInto("tags")
        .values({
          id: newId(),
          workspaceId,
          name: body.name,
          color: body.color ?? TAG_COLORS[Number(n) % TAG_COLORS.length] ?? "blue",
          createdAt: now(),
        })
        .returning(["id", "name", "color"])
        .executeTakeFirstOrThrow()
      return c.json({ tag: toJson(tag) }, 201)
    })
}

export function tagRoutes({ db }: Deps) {
  // Outsiders get NOT_FOUND, same as a missing tag.
  const requireTag = async (userId: string, tagId: string) => {
    const tag = await db.selectFrom("tags").selectAll().where("id", "=", tagId).executeTakeFirst()
    if (!tag) throw new ApiError("NOT_FOUND", "Tag not found")
    await requireMembership(db, userId, tag.workspaceId).catch(() => {
      throw new ApiError("NOT_FOUND", "Tag not found")
    })
    return tag
  }

  return new Hono<AppEnv>()
    .use(requireUser(db))
    .patch("/:tagId", validate("json", patchBody), async (c) => {
      const tag = await requireTag(c.var.user.id, c.req.param("tagId"))
      const patch = c.req.valid("json")
      if (patch.name && (await nameTaken(db, tag.workspaceId, patch.name, tag.id))) {
        throw conflict()
      }
      const updated = await db
        .updateTable("tags")
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.color !== undefined && { color: patch.color }),
        })
        .where("id", "=", tag.id)
        .returning(["id", "name", "color"])
        .executeTakeFirstOrThrow()
      return c.json({ tag: toJson(updated) })
    })
    .delete("/:tagId", async (c) => {
      const tag = await requireTag(c.var.user.id, c.req.param("tagId"))
      // task_tags rows go with it through the foreign key cascade.
      await db.deleteFrom("tags").where("id", "=", tag.id).execute()
      return c.body(null, 204)
    })
}
