export type Env = Record<string, string | undefined>

export type Mode = {
  // stdout is a terminal (or pretends to be): aligned tables, headers, relative dates.
  tty: boolean
  color: boolean
  width: number
}

const set = (v: string | undefined) => v !== undefined && v !== "" && v !== "0" && v !== "false"

// INTESA_FORCE_TTY forces terminal output; a number also sets the width, which keeps
// table fitting testable without a real terminal.
export function detectMode(
  env: Env,
  opts: { color: boolean; configColor?: string },
  stdout: { isTTY?: boolean; columns?: number } = process.stdout,
): Mode {
  const forced = env.INTESA_FORCE_TTY
  const tty = set(forced) || Boolean(stdout.isTTY)
  const forcedWidth = Number(forced)
  const width =
    Number.isInteger(forcedWidth) && forcedWidth > 1 ? forcedWidth : stdout.columns || 80
  return { tty, width, color: wantsColor(env, tty, opts) }
}

function wantsColor(env: Env, tty: boolean, opts: { color: boolean; configColor?: string }) {
  if (!opts.color || set(env.NO_COLOR)) return false
  if (set(env.CLICOLOR_FORCE)) return true
  if (opts.configColor === "never") return false
  if (opts.configColor === "always") return true
  if (env.CLICOLOR === "0") return false
  return tty
}

// Prompts need a person on both ends; agents and CI never get one.
export function canPrompt(env: Env, opts: { yes: boolean; configPrompt?: string }) {
  return (
    Boolean(process.stdin.isTTY && process.stdout.isTTY) &&
    !opts.yes &&
    !set(env.CI) &&
    !set(env.INTESA_PROMPT_DISABLED) &&
    opts.configPrompt !== "disabled"
  )
}
