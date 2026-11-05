import { z } from "zod"
import { resolver } from "../client/resolve"
import { confirmDestructive, isInteractive } from "../io/prompt"
import { usageError } from "../output/errors"
import { rows, section } from "../output/render"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"

type Webhook = {
  url: string
  mergeBranch: string
  productionBranch: string
  tokenSet: boolean
  createdAt: string
}

const showWebhook = (ctx: Ctx, hook: Webhook, secret?: string) =>
  section(
    ctx.mode,
    "GitHub webhook",
    rows(
      ctx.mode,
      [
        { name: "Payload URL", value: hook.url },
        ...(secret ? [{ name: "Secret", value: secret }] : []),
        { name: "Merge branch", value: hook.mergeBranch },
        { name: "Production branch", value: hook.productionBranch },
        { name: "GitHub token", value: hook.tokenSet ? "set" : "not set" },
      ],
      ["name", "value"],
    ),
  )

async function githubApi(ctx: Ctx) {
  const { client } = await ctx.http()
  const { id } = await resolver(ctx).workspace()
  return { api: client.api.workspaces[":workspaceId"].github, param: { workspaceId: id } }
}

const view = defineCommand({
  name: "view",
  summary: "Show the workspace's GitHub webhook",
  description:
    "Show where GitHub should send pull request events for this workspace, the branch whose\n" +
    "merges move tasks to review, and whether a GitHub token is set. The secret and token are\n" +
    "never shown.",
  context: ["workspace"],
  output: "github",
  examples: ["intesa github view", "intesa github view --json --fields url"],
  async run(ctx) {
    const { api, param } = await githubApi(ctx)
    const { github } = await (await api.$get({ param })).json()
    if (!github) {
      throw usageError(
        "this workspace has no GitHub webhook",
        "a workspace owner can create one with `intesa github create`",
      )
    }
    return github
  },
  human: (ctx, data) => showWebhook(ctx, data),
})

const create = defineCommand({
  name: "create",
  summary: "Create the workspace's GitHub webhook, or give it a new secret (owners only)",
  description:
    "Create the webhook and print its payload URL and secret, to paste into GitHub (content\n" +
    'type application/json, "Pull requests" and "Pushes" events). Run again to replace the\n' +
    "secret: the URL stays the same and deliveries signed with the old secret are refused. The\n" +
    "secret is shown only here. Replacing it asks first on a terminal; otherwise --yes is\n" +
    "required. To see the URL, use `intesa github view`.",
  context: ["workspace"],
  output: "githubCreated",
  examples: [
    "intesa github create",
    "intesa github create --json --fields url,secret",
    "intesa github create --yes",
  ],
  async run(ctx) {
    const { api, param } = await githubApi(ctx)
    if ((await (await api.$get({ param })).json()).github) {
      await confirmDestructive(
        ctx,
        "Replace the webhook's secret? GitHub's deliveries are refused until you paste the new one in",
      )
    }
    const { github, secret } = await (await api.$post({ param })).json()
    return { ...github, secret }
  },
  human: (ctx, { secret, ...hook }) =>
    `${showWebhook(ctx, hook, secret)}\nCopy the secret into GitHub now. It won't be shown again.\n`,
})

const edit = defineCommand({
  name: "edit",
  summary: "Change the webhook's branches (owners only)",
  description:
    "Merging a task's pull requests into the merge branch moves the task to review. When code\n" +
    "merges or is pushed into the production branch, Intesa checks which tasks' code reached\n" +
    "it, and shows them as in that branch instead of the merge branch.",
  flags: z.object({
    mergeBranch: z
      .string()
      .optional()
      .meta({ placeholder: "branch", description: "The merge branch" }),
    productionBranch: z
      .string()
      .optional()
      .meta({ placeholder: "branch", description: "The production branch" }),
  }),
  context: ["workspace"],
  output: "github",
  examples: ["intesa github edit --merge-branch qa", "intesa github edit --production-branch main"],
  async run(ctx, _args, flags) {
    if (flags.mergeBranch === undefined && flags.productionBranch === undefined) {
      throw usageError("nothing to change: pass --merge-branch or --production-branch")
    }
    const { api, param } = await githubApi(ctx)
    const res = await api.$patch({
      param,
      json: { mergeBranch: flags.mergeBranch, productionBranch: flags.productionBranch },
    })
    return (await res.json()).github
  },
  human: (ctx, data) => showWebhook(ctx, data),
})

// The token comes from stdin so it stays out of the shell history.
const token = defineCommand({
  name: "token",
  summary: "Set the GitHub token from stdin (owners only)",
  description:
    "Read a GitHub token from the first line of stdin, or remove it with --clear. Intesa uses\n" +
    "it to look a pull request up when someone links one and to check which code reached the\n" +
    "production branch; a fine-grained token with read-only Pull requests and Contents access\n" +
    "is enough. It is never shown again.",
  flags: z.object({
    clear: z.boolean().default(false).meta({ description: "Remove the token" }),
  }),
  context: ["workspace"],
  output: "github",
  examples: ["intesa github token < token.txt", "intesa github token --clear"],
  async run(ctx, _args, flags) {
    let value: string | null = null
    if (!flags.clear) {
      if (isInteractive(ctx)) {
        throw usageError(
          "pipe the token in, so it is not echoed or kept in your history",
          "e.g. `intesa github token < token.txt`",
        )
      }
      value = (await ctx.readStdin()).split(/\r?\n/)[0]?.trim() || null
      if (!value) throw usageError("the token is read from stdin, which was empty")
    }
    const { api, param } = await githubApi(ctx)
    return (await (await api.$patch({ param, json: { token: value } })).json()).github
  },
  human: (ctx, data) => showWebhook(ctx, data),
})

const remove = defineCommand({
  name: "delete",
  summary: "Delete the workspace's GitHub webhook (owners only)",
  description:
    "GitHub's deliveries are refused from then on and the token is removed. Pull requests\n" +
    "already linked stay on their tasks. Asks first on a terminal; otherwise --yes is required.",
  context: ["workspace"],
  output: "deleted",
  examples: ["intesa github delete", "intesa github delete --yes"],
  async run(ctx) {
    const { api, param } = await githubApi(ctx)
    await confirmDestructive(ctx, "Delete this workspace's GitHub webhook?")
    await api.$delete({ param })
    ctx.done("Deleted the GitHub webhook")
    return { deleted: true }
  },
  human: () => "",
})

export default defineGroup({
  name: "github",
  summary: "Set up the workspace's GitHub webhook",
  commands: [view, create, edit, token, remove],
  examples: ["intesa github create", "intesa github edit --merge-branch qa"],
})
