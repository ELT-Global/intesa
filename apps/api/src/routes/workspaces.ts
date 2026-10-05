import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { type Db, newId, now } from "../db"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"
import { type Role, requireMembership } from "../workspaces/membership"

type WorkspaceJson = { id: string; name: string; slug: string; role: Role }

const name = z.string().trim().min(1).max(80)
const slug = z
  .string()
  .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens")
  .min(2)
  .max(40)

const createBody = z.object({ name, slug: slug.optional() })
const patchBody = z.object({ name })

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")

async function loadWorkspace(db: Db, userId: string, workspaceId: string): Promise<WorkspaceJson> {
  const role = await requireMembership(db, userId, workspaceId)
  const ws = await db
    .selectFrom("workspaces")
    .select(["id", "name", "slug"])
    .where("id", "=", workspaceId)
    .executeTakeFirstOrThrow()
  return { ...ws, role }
}

async function slugTaken(db: Db, value: string) {
  const row = await db
    .selectFrom("workspaces")
    .select("id")
    .where("slug", "=", value)
    .executeTakeFirst()
  return row !== undefined
}

export function workspaceRoutes({ db }: Deps) {
  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/", async (c) => {
      const rows = await db
        .selectFrom("workspaceMembers")
        .innerJoin("workspaces", "workspaces.id", "workspaceMembers.workspaceId")
        .select(["workspaces.id", "workspaces.name", "workspaces.slug", "workspaceMembers.role"])
        .where("workspaceMembers.userId", "=", c.var.user.id)
        .orderBy("workspaces.name")
        .execute()
      return c.json({ workspaces: rows satisfies WorkspaceJson[] })
    })
    .post("/", validate("json", createBody), async (c) => {
      const body = c.req.valid("json")
      const wsSlug = body.slug ?? slugify(body.name)
      if (!slug.safeParse(wsSlug).success) {
        throw new ApiError("VALIDATION_ERROR", "Could not derive a valid slug from the name")
      }
      const taken = new ApiError("CONFLICT", "That slug is already taken")
      if (await slugTaken(db, wsSlug)) throw taken

      const id = newId()
      const ts = now()
      try {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto("workspaces")
            .values({ id, name: body.name, slug: wsSlug, createdAt: ts, updatedAt: ts })
            .execute()
          await trx
            .insertInto("workspaceMembers")
            .values({
              id: newId(),
              workspaceId: id,
              userId: c.var.user.id,
              role: "owner",
              createdAt: ts,
            })
            .execute()
        })
      } catch (err) {
        // A concurrent request may have claimed the slug after the check above.
        if (await slugTaken(db, wsSlug)) throw taken
        throw err
      }
      return c.json(
        { workspace: { id, name: body.name, slug: wsSlug, role: "owner" as Role } },
        201,
      )
    })
    .get("/:workspaceId", async (c) => {
      const workspace = await loadWorkspace(db, c.var.user.id, c.req.param("workspaceId"))
      return c.json({ workspace })
    })
    .patch("/:workspaceId", validate("json", patchBody), async (c) => {
      const workspaceId = c.req.param("workspaceId")
      const role = await requireMembership(db, c.var.user.id, workspaceId)
      if (role !== "owner") {
        throw new ApiError("FORBIDDEN", "Only workspace owners can do this")
      }
      await db
        .updateTable("workspaces")
        .set({ name: c.req.valid("json").name, updatedAt: now() })
        .where("id", "=", workspaceId)
        .execute()
      return c.json({ workspace: await loadWorkspace(db, c.var.user.id, workspaceId) })
    })
}
