import { Hono } from "hono"
import { z } from "zod"
import { type AppEnv, requireUser } from "../auth/middleware"
import { findOrCreateUser } from "../auth/users"
import type { Deps } from "../deps"
import { ApiError } from "../lib/errors"
import { validate } from "../lib/validate"
import {
  addMember,
  changeRole,
  listMembers,
  removeMember,
  requireMember,
} from "../workspaces/members"
import { requireMembership } from "../workspaces/membership"

const role = z.enum(["owner", "member"])
const addBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: role.default("member"),
})
const patchBody = z.object({ role })

export function memberRoutes({ db }: Deps) {
  const requireOwner = async (userId: string, workspaceId: string) => {
    if ((await requireMembership(db, userId, workspaceId)) !== "owner") {
      throw new ApiError("FORBIDDEN", "Only workspace owners can do this")
    }
  }

  return new Hono<AppEnv>()
    .use(requireUser(db))
    .get("/:workspaceId/members", async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireMembership(db, c.var.user.id, workspaceId)
      return c.json({ members: await listMembers(db, workspaceId) })
    })
    .post("/:workspaceId/members", validate("json", addBody), async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireOwner(c.var.user.id, workspaceId)
      const { email, role } = c.req.valid("json")
      // Unknown emails get a placeholder account that is linked on first Google sign-in.
      const user = await findOrCreateUser(db, { email })
      const id = await addMember(db, workspaceId, user.id, role)
      return c.json({ member: await requireMember(db, workspaceId, id) }, 201)
    })
    .patch("/:workspaceId/members/:memberId", validate("json", patchBody), async (c) => {
      const workspaceId = c.req.param("workspaceId")
      await requireOwner(c.var.user.id, workspaceId)
      const member = await requireMember(db, workspaceId, c.req.param("memberId"))
      await changeRole(db, workspaceId, member, c.req.valid("json").role)
      return c.json({ member: await requireMember(db, workspaceId, member.id) })
    })
    .delete("/:workspaceId/members/:memberId", async (c) => {
      const workspaceId = c.req.param("workspaceId")
      const callerRole = await requireMembership(db, c.var.user.id, workspaceId)
      const member = await requireMember(db, workspaceId, c.req.param("memberId"))
      if (callerRole !== "owner" && member.userId !== c.var.user.id) {
        throw new ApiError("FORBIDDEN", "Only workspace owners can remove other members")
      }
      await removeMember(db, workspaceId, member)
      return c.body(null, 204)
    })
}
