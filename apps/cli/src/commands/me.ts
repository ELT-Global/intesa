import { z } from "zod"
import { links } from "../client/links"
import { openOrPrint } from "../io/browser"
import { askText } from "../io/prompt"
import { asTable } from "../output/render"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"

const view = defineCommand({
  name: "view",
  summary: "Show your account",
  output: "account",
  examples: ["intesa me", "intesa me --json --fields email,totpEnabled"],
  async run(ctx) {
    const { client } = await ctx.http()
    return (await (await client.api.me.$get()).json()).user
  },
})

const edit = defineCommand({
  name: "edit",
  summary: "Change your display name",
  flags: z.object({
    name: z
      .string()
      .optional()
      .meta({ placeholder: "name", description: "New display name (asked for on a terminal)" }),
  }),
  output: "account",
  examples: ['intesa me edit --name "Alan Turing"'],
  async run(ctx, _args, flags) {
    const { client } = await ctx.http()
    const name =
      flags.name ??
      (await askText(ctx, {
        flag: "--name",
        message: "Display name",
        initialValue: async () => (await (await client.api.me.$get()).json()).user.name,
        validate: (v) => (v.trim() ? undefined : "Enter a name"),
      }))
    return (await (await client.api.me.$patch({ json: { name } })).json()).user
  },
})

// An API token cannot enrol an authenticator, so enabling happens in the web app.
async function enableInWebApp(ctx: Ctx) {
  const { client, host } = await ctx.http()
  if ((await (await client.api.me.$get()).json()).user.totpEnabled) {
    ctx.stderr("Two-factor sign-in is already enabled.\n")
    return { totpEnabled: true }
  }
  ctx.stderr("Two-factor sign-in is set up in the web app, where you scan the QR code.\n")
  const url = links.settings(host)
  openOrPrint(ctx, url, " to turn it on")
  return { url }
}

async function disableTwoFactor(ctx: Ctx, code: string | undefined) {
  const { client } = await ctx.http()
  const value =
    code ??
    (await askText(ctx, {
      flag: "--code",
      message: "Current code from your authenticator app",
      validate: (v) => (/^\d{6}$/.test(v) ? undefined : "Enter the 6-digit code"),
    }))
  return (await (await client.api.me["2fa"].disable.$post({ json: { code: value } })).json()).user
}

const twoFa = defineCommand({
  name: "2fa",
  summary: "Enable or disable two-factor sign-in",
  description: [
    "Manage two-factor sign-in with an authenticator app.",
    "",
    "`enable` points you to the web app settings, where the QR code is shown: an API token",
    "cannot enrol an authenticator. It opens the page on a terminal and always prints the URL.",
    "`disable` needs a current code from your authenticator app.",
  ].join("\n"),
  args: [{ name: "action", required: true, enum: ["enable", "disable"] as const }],
  flags: z.object({
    code: z
      .string()
      .regex(/^\d{6}$/, "expected 6 digits")
      .optional()
      .meta({
        placeholder: "123456",
        description: "Authenticator code for disable (asked for on a terminal)",
      }),
  }),
  output: "twoFactor",
  examples: [
    "intesa me 2fa enable",
    "intesa me 2fa enable --json",
    "intesa me 2fa disable --code 123456",
  ],
  run: (ctx, { action }, flags): Promise<Record<string, unknown>> =>
    action === "enable" ? enableInWebApp(ctx) : disableTwoFactor(ctx, flags.code),
  // The settings link on its own line, for copying; after disable, the account.
  human: (ctx, data) =>
    typeof data.url === "string"
      ? `${data.url}\n`
      : "id" in data
        ? asTable(ctx.mode, data, "twoFactor")
        : "",
})

export default defineGroup({
  name: "me",
  summary: "View and edit your account, including two-factor sign-in",
  description: "View and edit your own account. `intesa me` alone is `intesa me view`.",
  commands: [view, edit, twoFa],
  defaultCommand: "view",
  examples: ["intesa me", 'intesa me edit --name "Alan Turing"', "intesa me 2fa enable"],
})
