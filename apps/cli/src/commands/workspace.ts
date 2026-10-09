import { z } from "zod"
import { workspaceSlugs } from "../client/candidates"
import { saveDefault } from "../client/context"
import { links } from "../client/links"
import { resolver } from "../client/resolve"
import { defineCommand, defineGroup } from "../registry/define"

type Workspace = { id: string; name: string; slug: string; role: string }
const withUrl = (host: string, w: Workspace) => ({ ...w, url: links.workspace(host, w.slug) })

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List your workspaces",
  output: "workspace",
  examples: ["intesa workspace list", "intesa ws list --json --fields slug,role"],
  async run(ctx) {
    const { host } = await ctx.http()
    return (await resolver(ctx).workspaces()).map((w) => withUrl(host, w))
  },
})

const view = defineCommand({
  name: "view",
  summary: "Show a workspace",
  description: "Show a workspace: the one named, or the current one.",
  args: [
    {
      name: "slug",
      description: "Workspace slug (default: the current workspace)",
      complete: workspaceSlugs,
    },
  ],
  context: ["workspace"],
  output: "workspace",
  examples: ["intesa workspace view", "intesa ws view acme --json"],
  async run(ctx, { slug }) {
    const http = await ctx.http()
    const { id } = await resolver(ctx).workspace(slug)
    const res = await http.client.api.workspaces[":workspaceId"].$get({
      param: { workspaceId: id },
    })
    return withUrl(http.host, (await res.json()).workspace)
  },
})

const create = defineCommand({
  name: "create",
  summary: "Create a workspace",
  description:
    "Create a workspace, with you as its owner. The slug is derived from the name unless\n" +
    "--slug is given; it is what -w and the web links use.",
  args: [{ name: "name", required: true }],
  flags: z.object({
    slug: z
      .string()
      .optional()
      .meta({ placeholder: "slug", description: "Lowercase letters, numbers and hyphens" }),
  }),
  output: "workspace",
  examples: ['intesa workspace create "Acme Corp"', "intesa ws create Acme --slug acme"],
  async run(ctx, { name }, flags) {
    const http = await ctx.http()
    const res = await http.client.api.workspaces.$post({ json: { name, slug: flags.slug } })
    return withUrl(http.host, (await res.json()).workspace)
  },
})

const rename = defineCommand({
  name: "rename",
  summary: "Rename the current workspace",
  description: "Rename the current workspace (owners only). The slug does not change.",
  args: [{ name: "new-name", required: true }],
  context: ["workspace"],
  output: "workspace",
  examples: ['intesa workspace rename "Acme Inc"', 'intesa ws rename "Acme Inc" -w acme'],
  async run(ctx, args) {
    const http = await ctx.http()
    const { id } = await resolver(ctx).workspace()
    const res = await http.client.api.workspaces[":workspaceId"].$patch({
      param: { workspaceId: id },
      json: { name: args["new-name"] },
    })
    return withUrl(http.host, (await res.json()).workspace)
  },
})

const use = defineCommand({
  name: "use",
  summary: "Set the default workspace",
  description:
    "Make a workspace the default for later commands, in the user config. With --local it is\n" +
    "written to .intesa.json in the current directory instead, which applies to commands run\n" +
    "in this directory and below.",
  args: [{ name: "slug", required: true, complete: workspaceSlugs }],
  flags: z.object({
    local: z
      .boolean()
      .default(false)
      .meta({ description: "Write .intesa.json in the current directory" }),
  }),
  output: "workspaceDefault",
  examples: ["intesa workspace use acme", "intesa ws use acme --local"],
  async run(ctx, { slug }, flags) {
    const ws = await resolver(ctx).workspace(slug)
    const file = saveDefault(ctx, "workspace", ws.slug, flags.local)
    ctx.done(
      flags.local
        ? `Using workspace ${ws.slug} in this directory (${file})`
        : `Default workspace set to ${ws.slug}`,
    )
    return { id: ws.id, slug: ws.slug, file }
  },
  human: () => "",
})

export default defineGroup({
  name: "workspace",
  aliases: ["ws"],
  summary: "List, create and switch workspaces",
  commands: [list, view, create, rename, use],
  examples: ["intesa workspace list", "intesa ws use acme"],
})
