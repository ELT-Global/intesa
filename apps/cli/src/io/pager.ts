import type { Config } from "../config/config"
import type { Mode } from "../output/mode"
import { type Env, isSet } from "../output/mode"
import { splitCommand } from "./command"
import { automated } from "./prompt"

// The pager command. The `pager` config key wins over INTESA_PAGER, then PAGER; the first one
// that is set decides, and an empty value or `cat` means no pager. With none set, `less` on
// platforms that have one (Windows has no pager worth assuming).
export function pagerCommand(opts: {
  env: Env
  configPager?: string
  platform?: string
  hasLess?: boolean
}): string[] | undefined {
  const set = [opts.configPager, opts.env.INTESA_PAGER, opts.env.PAGER].find((v) => v !== undefined)
  const fallback =
    (opts.platform ?? process.platform) !== "win32" && (opts.hasLess ?? Boolean(Bun.which("less")))
  const command = splitCommand(set ?? (fallback ? "less" : ""))
  const [program] = command
  if (program === undefined || /^(.*[/])?cat(\.exe)?$/i.test(program)) return undefined
  return command
}

// While a pager has the terminal, Ctrl+C is the pager's, so main does not exit on SIGINT then.
let open = 0
export const paging = () => open > 0

// Shows `text` through the pager and returns true. Returns false, leaving the printing to the
// caller, when no pager applies: stdout is not a terminal, nobody is there to read it (CI,
// prompts disabled, no terminal on stdin) or no pager is configured or could be started.
export async function page(
  ctx: { env: Env; config: Config; mode: Mode },
  text: string,
): Promise<boolean> {
  const { env } = ctx
  // INTESA_FORCE_TTY stands in for the terminal on stdin as well as on stdout.
  const attended = isSet(env.INTESA_FORCE_TTY) || Boolean(process.stdin.isTTY)
  if (!ctx.mode.tty || !attended || automated(ctx) || text === "") return false
  const command = pagerCommand({ env, configPager: ctx.config.pager })
  if (!command) return false

  let proc: ReturnType<typeof Bun.spawn<"pipe", "inherit", "inherit">>
  try {
    // `less -F -R -X` unless LESS says otherwise: short output prints and exits, colors pass.
    proc = Bun.spawn(command, {
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit",
      env: { ...env, LESS: env.LESS ?? "FRX" },
    })
  } catch {
    return false
  }
  open++
  try {
    // A pager that quits before reading everything closes the pipe; that is not an error.
    try {
      proc.stdin.write(text)
      await proc.stdin.end()
    } catch {}
    await proc.exited
  } finally {
    open--
  }
  return true
}
