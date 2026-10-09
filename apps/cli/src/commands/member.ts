import { z } from "zod"
import { resolver } from "../client/resolve"
import { confirmDestructive } from "../io/prompt"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"

const ROLES = ["owner", "member"] as const

const memberArg = {
  name: "member",
  required: true,
  description: "Email, exact name (any case), id or @me",
  complete: async (ctx: Ctx, { word }: { word: string }) =>
    ["@me", ...(await resolver(ctx).members()).map((m) => m.email)].filter((c) =>
      c.startsWith(word.toLowerCase()),
    ),
} as const

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List the workspace's members",
  context: ["workspace"],
  output: "member",
  examples: ["intesa member list", "intesa member list --json --fields email,role"],
  async run(ctx) {
    return resolver(ctx).members()
  },
})

const add = defineCommand({
  name: "add",
  summary: "Add someone to the workspace",
  description:
    "Add a person to the workspace by email (owners only). Someone who has not signed in yet\n" +
    "gets an account that is linked when they first do.",
  args: [{ name: "email", required: true }],
  flags: z.object({
    role: z
      .enum(ROLES)
      .default("member")
      .meta({ placeholder: "role", description: "What they may do in the workspace" }),
  }),
  context: ["workspace"],
  output: "member",
  examples: ["intesa member add ada@example.com", "intesa member add ada@example.com --role owner"],
  async run(ctx, { email }, flags) {
    const http = await ctx.http()
    const { id } = await resolver(ctx).workspace()
    const res = await http.client.api.workspaces[":workspaceId"].members.$post({
      param: { workspaceId: id },
      json: { email, role: flags.role },
    })
    return (await res.json()).member
  },
})

const role = defineCommand({
  name: "role",
  summary: "Change a member's role",
  description:
    "Make a member an owner or a plain member (owners only). A workspace always keeps at\n" +
    "least one owner.",
  args: [memberArg, { name: "role", required: true, enum: ROLES }],
  context: ["workspace"],
  output: "member",
  examples: ["intesa member role ada@example.com owner", "intesa member role @me member"],
  async run(ctx, args) {
    const r = resolver(ctx)
    const [member, { id }, http] = await Promise.all([
      r.member(args.member),
      r.workspace(),
      ctx.http(),
    ])
    const res = await http.client.api.workspaces[":workspaceId"].members[":memberId"].$patch({
      param: { workspaceId: id, memberId: member.id },
      json: { role: args.role as (typeof ROLES)[number] },
    })
    return (await res.json()).member
  },
})

const remove = defineCommand({
  name: "remove",
  summary: "Remove a member from the workspace",
  description:
    "Remove a member and their task assignments in this workspace (owners only). Asks first\n" +
    "on a terminal; otherwise --yes is required.",
  args: [memberArg],
  context: ["workspace"],
  output: "deleted",
  examples: ["intesa member remove ada@example.com", "intesa member remove ada@example.com --yes"],
  async run(ctx, { member: ref }) {
    const r = resolver(ctx)
    const [member, { id, slug }] = await Promise.all([r.member(ref), r.workspace()])
    await confirmDestructive(ctx, `Remove ${member.name} <${member.email}> from ${slug}?`)
    const http = await ctx.http()
    await http.client.api.workspaces[":workspaceId"].members[":memberId"].$delete({
      param: { workspaceId: id, memberId: member.id },
    })
    ctx.done(`Removed ${member.email} from ${slug}`)
    return { id: member.id, email: member.email, deleted: true }
  },
  human: () => "",
})

const leave = defineCommand({
  name: "leave",
  summary: "Leave the workspace",
  description:
    "Leave the current workspace. The last owner cannot leave. Asks first on a terminal;\n" +
    "otherwise --yes is required.",
  context: ["workspace"],
  output: "deleted",
  examples: ["intesa member leave -w acme", "intesa member leave -w acme --yes"],
  async run(ctx) {
    const r = resolver(ctx)
    const [member, { id, slug }] = await Promise.all([r.member("@me"), r.workspace()])
    await confirmDestructive(ctx, `Leave workspace ${slug}?`)
    const http = await ctx.http()
    await http.client.api.workspaces[":workspaceId"].members[":memberId"].$delete({
      param: { workspaceId: id, memberId: member.id },
    })
    ctx.done(`Left workspace ${slug}`)
    return { id: member.id, email: member.email, deleted: true }
  },
  human: () => "",
})

export default defineGroup({
  name: "member",
  summary: "List, add and manage workspace members",
  commands: [list, add, role, remove, leave],
  examples: ["intesa member list", "intesa member add ada@example.com --role owner"],
})
