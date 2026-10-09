import { TAG_COLORS } from "@intesa/api/schemas"
import { z } from "zod"
import { resolver } from "../client/resolve"
import { confirmDestructive } from "../output/ask"
import { usageError } from "../output/errors"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"

const tagArg = {
  name: "tag",
  required: true,
  description: "Tag name (any case) or id",
  // A name with spaces would be split by the shell, so only single words are offered.
  complete: async (ctx: Ctx, { word }: { word: string }) =>
    (await resolver(ctx).tags())
      .map((t) => t.name)
      .filter((n) => !/\s/.test(n) && n.toLowerCase().startsWith(word.toLowerCase())),
} as const

// Not `--color`: that name belongs to the global `--no-color` switch.
const tagColor = z
  .enum(TAG_COLORS)
  .optional()
  .meta({ placeholder: "color", description: "Tag colour" })

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List the workspace's tags",
  context: ["workspace"],
  output: "tag",
  examples: ["intesa tag list", "intesa tag list --json --fields name,color"],
  async run(ctx) {
    return resolver(ctx).tags()
  },
})

const create = defineCommand({
  name: "create",
  summary: "Create a tag",
  description:
    "Create a tag in the workspace. Names are unique ignoring case. Without --tag-color the\n" +
    "server picks the next colour of the palette.",
  args: [{ name: "name", required: true }],
  flags: z.object({ tagColor }),
  context: ["workspace"],
  output: "tag",
  examples: ["intesa tag create Urgent", "intesa tag create Urgent --tag-color magenta"],
  async run(ctx, { name }, flags) {
    const http = await ctx.http()
    const { id } = await resolver(ctx).workspace()
    const res = await http.client.api.workspaces[":workspaceId"].tags.$post({
      param: { workspaceId: id },
      json: { name, color: flags.tagColor },
    })
    return (await res.json()).tag
  },
})

const edit = defineCommand({
  name: "edit",
  summary: "Rename or recolour a tag",
  args: [tagArg],
  flags: z.object({
    name: z.string().optional().meta({ placeholder: "name", description: "New name" }),
    tagColor,
  }),
  context: ["workspace"],
  output: "tag",
  examples: [
    'intesa tag edit Urgent --name "Very urgent"',
    "intesa tag edit Urgent --tag-color gray",
  ],
  async run(ctx, { tag: ref }, flags) {
    if (flags.name === undefined && flags.tagColor === undefined) {
      throw usageError("nothing to change: pass --name or --tag-color")
    }
    const tag = await resolver(ctx).tag(ref)
    const http = await ctx.http()
    const res = await http.client.api.tags[":tagId"].$patch({
      param: { tagId: tag.id },
      json: { name: flags.name, color: flags.tagColor },
    })
    return (await res.json()).tag
  },
})

const remove = defineCommand({
  name: "delete",
  summary: "Delete a tag",
  description:
    "Delete a tag and remove it from every task that has it. Asks first on a terminal;\n" +
    "otherwise --yes is required.",
  args: [tagArg],
  context: ["workspace"],
  examples: ["intesa tag delete Urgent", "intesa tag delete Urgent --yes"],
  async run(ctx, { tag: ref }) {
    const tag = await resolver(ctx).tag(ref)
    await confirmDestructive(ctx, `Delete tag ${tag.name} and remove it from all tasks?`)
    const http = await ctx.http()
    await http.client.api.tags[":tagId"].$delete({ param: { tagId: tag.id } })
    ctx.stderr(`✓ Deleted tag ${tag.name}\n`)
    if (ctx.globals.json) return { id: tag.id, name: tag.name, deleted: true }
  },
})

export default defineGroup({
  name: "tag",
  summary: "List, create and manage tags",
  commands: [list, create, edit, remove],
  examples: ["intesa tag list", "intesa tag create Urgent --tag-color magenta"],
})
