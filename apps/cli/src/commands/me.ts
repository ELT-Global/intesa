import { z } from "zod"
import { openBrowser } from "../io/browser"
import { askText } from "../output/ask"
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
        initialValue: (await (await client.api.me.$get()).json()).user.name,
        validate: (v) => (v.trim() ? undefined : "Enter a name"),
      }))
    return (await (await client.api.me.$patch({ json: { name } })).json()).user
  },
})

// An API token cannot enrol an authenticator, so enabling happens in the web app.
async function enableInWebApp(ctx: Ctx) {
  const { client, host } = await ctx.http()
  const url = `${host}/settings`
  if ((await (await client.api.me.$get()).json()).user.totpEnabled) {
    ctx.stderr("Two-factor sign-in is already enabled.\n")
    return ctx.globals.json ? { totpEnabled: true } : undefined
  }
  ctx.stderr("Two-factor sign-in is set up in the web app, where you scan the QR code.\n")
  const person = Boolean(process.stdin.isTTY && process.stderr.isTTY)
  if (person && openBrowser(url, { env: ctx.env, configBrowser: ctx.config.browser })) {
    ctx.stderr(`Opening ${url} in your browser…\n`)
  } else {
    ctx.stderr(`Open ${url} in your browser to turn it on.\n`)
  }
  if (ctx.globals.json) return { url }
  ctx.stdout(`${url}\n`)
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
  run: (ctx, { action }, flags) =>
    action === "enable" ? enableInWebApp(ctx) : disableTwoFactor(ctx, flags.code),
})

export default defineGroup({
  name: "me",
  summary: "View and edit your account, including two-factor sign-in",
  description: "View and edit your own account. `intesa me` alone is `intesa me view`.",
  commands: [view, edit, twoFa],
  defaultCommand: "view",
  examples: ["intesa me", 'intesa me edit --name "Alan Turing"', "intesa me 2fa enable"],
})
