import { cancelled, usageError } from "../output/errors"
import { isSet } from "../output/mode"
import type { Ctx } from "../registry/define"

// A person is at the terminal: stdin and stdout are terminals and nothing says this is
// automation (CI, INTESA_PROMPT_DISABLED, `prompt disabled`). Agents and scripts never are.
// Only then are prompts shown, editors and browsers opened.
export const personPresent = (ctx: Pick<Ctx, "env" | "config">) =>
  Boolean(process.stdin.isTTY && process.stdout.isTTY) &&
  !isSet(ctx.env.CI) &&
  !isSet(ctx.env.INTESA_PROMPT_DISABLED) &&
  ctx.config.prompt !== "disabled"

// Whether a person can be asked for missing input: one is there, and --yes was not given.
export const isInteractive = (ctx: Ctx) => personPresent(ctx) && !ctx.globals.yes

// Prompts go to stderr: stdout carries only data.

// A required value that was not given as a flag: asked for on a terminal, otherwise exit 2
// naming the flag. The initial value is only worked out when there is someone to ask.
export async function askText(
  ctx: Ctx,
  opts: {
    flag: string
    message: string
    initialValue?: () => Promise<string>
    validate?: (v: string) => string | undefined
  },
): Promise<string> {
  if (!isInteractive(ctx)) {
    throw usageError(`missing ${opts.flag} (required when not interactive)`)
  }
  const { text, isCancel } = await import("@clack/prompts")
  const value = await text({
    message: opts.message,
    initialValue: await opts.initialValue?.(),
    validate: (v) => opts.validate?.(v ?? ""),
    output: process.stderr,
  })
  if (isCancel(value)) throw cancelled()
  return value
}

// Destructive actions need `--yes` unless a person can be asked. --dry-run changes nothing.
export async function confirmDestructive(ctx: Ctx, message: string): Promise<void> {
  if (ctx.globals.yes || ctx.globals.dryRun) return
  if (!personPresent(ctx)) {
    throw usageError(`${message} (pass --yes to confirm when not interactive)`)
  }
  const { confirm, isCancel } = await import("@clack/prompts")
  const ok = await confirm({ message, initialValue: false, output: process.stderr })
  if (isCancel(ok) || !ok) throw cancelled()
}

// One of `options`; undefined when cancelled, so the caller decides what that means.
export async function choose<V extends string>(
  message: string,
  options: { value: V; label: string; hint?: string }[],
  initialValue?: V,
): Promise<V | undefined> {
  const { select, isCancel } = await import("@clack/prompts")
  const picked = await select<string>({ message, options, initialValue, output: process.stderr })
  return isCancel(picked) ? undefined : (picked as V)
}

// A yes/no question; cancelling is no.
export async function askYesNo(message: string, initialValue = true): Promise<boolean> {
  const { confirm, isCancel } = await import("@clack/prompts")
  const ok = await confirm({ message, initialValue, output: process.stderr })
  return !isCancel(ok) && ok
}
