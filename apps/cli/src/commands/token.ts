import { TOKEN_SCOPES } from "@intesa/api/schemas"
import { z } from "zod"
import { askText, confirmDestructive } from "../output/ask"
import { usageError } from "../output/errors"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"

const MAX_DAYS = 3650

// `90d`, `90` (days) or `never`. Unset and `never` both mean the token does not expire.
function expiresInDays(value: string | undefined): number | undefined {
  if (value === undefined || value === "never") return undefined
  const days = /^(\d+)d?$/.exec(value)?.[1]
  const n = days === undefined ? Number.NaN : Number(days)
  if (!(n >= 1 && n <= MAX_DAYS)) {
    throw usageError(
      `invalid value "${value}" for --expires: expected 1-${MAX_DAYS} days like 90d, or "never"`,
    )
  }
  return n
}

async function tokenIds(ctx: Ctx, { word }: { word: string }) {
  const { client } = await ctx.http()
  const { tokens } = await (await client.api.me.tokens.$get()).json()
  return tokens.map((t) => t.id).filter((id) => id.startsWith(word))
}

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List your API tokens",
  description:
    "List your API tokens: the ones made here with `token create`, and the ones issued to\n" +
    "each signed-in device. `current` marks the token this command is using. Plaintext\n" +
    "tokens are never shown again after they are created.",
  output: "apiToken",
  examples: ["intesa token list", "intesa token list --json --fields id,name,expiresAt"],
  async run(ctx) {
    const { client } = await ctx.http()
    const res = await client.api.me.tokens.$get()
    return (await res.json()).tokens
  },
})

const create = defineCommand({
  name: "create",
  summary: "Create a personal access token",
  description:
    "Create a personal access token and print it. The token is shown only once, so store it\n" +
    "now. Use it as INTESA_TOKEN, or with `Authorization: Bearer <token>`.\n\n" +
    "A read token can only read; a write token can do anything you can. A token does not\n" +
    "expire unless --expires says so.",
  flags: z.object({
    name: z.string().optional().meta({
      placeholder: "name",
      description: 'What the token is for, e.g. "ci" (asked for on a terminal)',
    }),
    scope: z
      .enum(TOKEN_SCOPES)
      .default("write")
      .meta({ placeholder: "scope", description: "What the token may do" }),
    expires: z.string().optional().meta({
      placeholder: "90d",
      description: "Expire after this many days (30d, 90), or never",
    }),
  }),
  output: "newApiToken",
  examples: [
    "intesa token create --name ci --scope read",
    "intesa token create --name laptop --expires 90d",
    "INTESA_TOKEN=$(intesa token create --name agent) intesa api /me",
  ],
  async run(ctx, _args, flags) {
    const days = expiresInDays(flags.expires)
    const name =
      flags.name ??
      (await askText(ctx, {
        flag: "--name",
        message: "What is this token for?",
        validate: (v) => (v.trim() ? undefined : "Enter a name"),
      }))
    const { client } = await ctx.http()
    const res = await client.api.me.tokens.$post({
      json: { name, scope: flags.scope, ...(days === undefined ? {} : { expiresInDays: days }) },
    })
    const created = await res.json()
    if (ctx.globals.json) return created
    // Just the token, so `$(intesa token create ...)` works; the reminder goes to stderr.
    ctx.stdout(`${created.token}\n`)
    if (!ctx.globals.quiet) ctx.stderr("This token will not be shown again. Store it now.\n")
  },
})

const revoke = defineCommand({
  name: "revoke",
  summary: "Revoke an API token",
  description:
    "Revoke an API token so it stops working immediately. Find ids with `intesa token list`.",
  args: [
    {
      name: "id",
      required: true,
      description: "Token id",
      complete: tokenIds,
    },
  ],
  examples: ["intesa token revoke 3f2c0d1e-...", "intesa token revoke 3f2c0d1e-... --yes"],
  async run(ctx, { id }) {
    await confirmDestructive(ctx, `Revoke token ${id}?`)
    const { client } = await ctx.http()
    await client.api.me.tokens[":tokenId"].$delete({ param: { tokenId: id } })
    if (ctx.globals.json) return { id, revoked: true }
    if (!ctx.globals.quiet) ctx.stderr(`Revoked token ${id}\n`)
  },
})

export default defineGroup({
  name: "token",
  summary: "Manage API tokens",
  description:
    "Create, list and revoke the API tokens that let scripts and agents act as you.\n" +
    "Signing in with `intesa auth login` creates one for this device too.",
  commands: [list, create, revoke],
  examples: ["intesa token list", "intesa token create --name ci --scope read"],
})
