import type { Ctx } from "../registry/define"
import { CliError, usageError } from "./errors"
import { canPrompt } from "./mode"

// Prompts go to stderr: stdout carries only data.
const cancelled = () => new CliError("cancelled", { code: "CANCELLED", exitCode: 3 })

const canAsk = (ctx: Ctx, yes: boolean) =>
  canPrompt(ctx.env, { yes, configPrompt: ctx.config.prompt })

// Whether a person can be asked for missing input (a terminal, and no --yes, CI or opt-out).
export const isInteractive = (ctx: Ctx) => canAsk(ctx, ctx.globals.yes)

// A required value that was not given as a flag: asked for on a terminal, otherwise exit 2
// naming the flag.
export async function askText(
  ctx: Ctx,
  opts: {
    flag: string
    message: string
    initialValue?: string
    validate?: (v: string) => string | undefined
  },
): Promise<string> {
  if (!isInteractive(ctx)) {
    throw usageError(`missing ${opts.flag} (required when not interactive)`)
  }
  const { text, isCancel } = await import("@clack/prompts")
  const value = await text({
    message: opts.message,
    initialValue: opts.initialValue,
    validate: (v) => opts.validate?.(v ?? ""),
    output: process.stderr,
  })
  if (isCancel(value)) throw cancelled()
  return value
}

// Destructive actions need `--yes` unless a person can be asked. --dry-run changes nothing.
export async function confirmDestructive(ctx: Ctx, message: string): Promise<void> {
  if (ctx.globals.yes || ctx.globals.dryRun) return
  if (!canAsk(ctx, false)) {
    throw usageError(`${message} (pass --yes to confirm when not interactive)`)
  }
  const { confirm, isCancel } = await import("@clack/prompts")
  const ok = await confirm({ message, initialValue: false, output: process.stderr })
  if (isCancel(ok) || !ok) throw cancelled()
}
