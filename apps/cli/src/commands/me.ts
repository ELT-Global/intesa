import { z } from "zod"
import { askText, isInteractive } from "../output/ask"
import { usageError } from "../output/errors"
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

type Enrollment = { secret: string; otpauthUrl: string }

// The URL and secret are always shown; the QR code is a convenience for a terminal.
async function showEnrollment(ctx: Ctx, { secret, otpauthUrl }: Enrollment) {
  const { renderUnicodeCompact } = await import("uqr")
  const qr = renderUnicodeCompact(otpauthUrl)
  // Light modules are drawn as full blocks, so force white on black to scan on any theme.
  const drawn = ctx.mode.color
    ? qr
        .split("\n")
        .map((line) => `\x1b[97;40m${line}\x1b[0m`)
        .join("\n")
    : qr
  ctx.stderr(
    `Scan this code with an authenticator app:\n\n${drawn}\n\n` +
      `Or add it by hand. Secret: ${secret}\n${otpauthUrl}\n\n`,
  )
}

const codeHint =
  "Run `intesa me 2fa setup`, add the secret to an authenticator app, then pass a code."

async function twoFactor(ctx: Ctx, action: string, code: string | undefined) {
  const { client } = await ctx.http()
  const setup = async () => (await (await client.api.me["2fa"].setup.$post()).json()) as Enrollment
  const askCode = (message: string) =>
    askText(ctx, {
      flag: "--code",
      message,
      validate: (v) => (/^\d{6}$/.test(v) ? undefined : "Enter the 6-digit code"),
    })

  if (action === "setup") {
    const enrollment = await setup()
    if (!ctx.globals.json && process.stderr.isTTY) await showEnrollment(ctx, enrollment)
    return enrollment
  }
  if (action === "enable") {
    let value = code
    if (!value) {
      if (!isInteractive(ctx))
        throw usageError("missing --code (required when not interactive)", codeHint)
      // Without --code the secret is made here, so a person can scan it and read the code back.
      await showEnrollment(ctx, await setup())
      value = await askCode("Code from your authenticator app")
    }
    return (await (await client.api.me["2fa"].enable.$post({ json: { code: value } })).json()).user
  }
  const value = code ?? (await askCode("Current code from your authenticator app"))
  return (await (await client.api.me["2fa"].disable.$post({ json: { code: value } })).json()).user
}

const twoFa = defineCommand({
  name: "2fa",
  summary: "Set up, enable or disable two-factor sign-in",
  description: [
    "Manage two-factor sign-in with an authenticator app.",
    "",
    "On a terminal, `enable` shows a QR code and the secret, then asks for the code your app",
    "shows. Scripts and agents cannot scan anything: run `setup` to get the secret and otpauth",
    "URL, generate a code from the secret, then pass it with `enable --code`. `disable` always",
    "needs a current code.",
  ].join("\n"),
  args: [{ name: "action", required: true, enum: ["setup", "enable", "disable"] as const }],
  flags: z.object({
    code: z
      .string()
      .regex(/^\d{6}$/, "expected 6 digits")
      .optional()
      .meta({ placeholder: "123456", description: "Authenticator code (asked for on a terminal)" }),
  }),
  output: "twoFactor",
  examples: [
    "intesa me 2fa enable",
    "intesa me 2fa setup --json",
    "intesa me 2fa enable --code 123456",
    "intesa me 2fa disable --code 123456",
  ],
  run: (ctx, { action }, flags) => twoFactor(ctx, action, flags.code),
})

export default defineGroup({
  name: "me",
  summary: "View and edit your account, including two-factor sign-in",
  description: "View and edit your own account. `intesa me` alone is `intesa me view`.",
  commands: [view, edit, twoFa],
  defaultCommand: "view",
  examples: ["intesa me", 'intesa me edit --name "Alan Turing"', "intesa me 2fa enable"],
})
