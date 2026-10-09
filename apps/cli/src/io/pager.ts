import type { Config } from "../config/config"
import type { Env } from "../output/mode"
import { splitCommand } from "./command"
import { personPresent } from "./prompt"

// The pager command. INTESA_PAGER is set for intesa alone, so it wins over the `pager` config
// key, which wins over PAGER; the first one that is set decides, and an empty value or `cat`
// means no pager. With none set, `less` on platforms that have one (Windows has no pager
// worth assuming).
export function pagerCommand(opts: {
  env: Env
  configPager?: string
  platform?: string
  hasLess?: boolean
}): string[] | undefined {
  const set = [opts.env.INTESA_PAGER, opts.configPager, opts.env.PAGER].find((v) => v !== undefined)
  const fallback =
    (opts.platform ?? process.platform) !== "win32" && (opts.hasLess ?? Boolean(Bun.which("less")))
  const command = splitCommand(set ?? (fallback ? "less" : ""))
  const [program] = command
  if (program === undefined || /^(.*[/\\])?cat(\.exe)?$/i.test(program)) return undefined
  return command
}

// While a pager has the terminal, Ctrl+C is the pager's, so main does not exit on SIGINT then.
let open = 0
export const paging = () => open > 0

// Shows `text` through the pager and returns true. Returns false, leaving the printing to the
// caller, when no pager applies: nobody is at a terminal to read it (INTESA_FORCE_TTY only
// changes formatting) or no pager is configured or could be started. A pager that fails is
// reported on stderr, since what it showed may be incomplete.
export async function page(
  ctx: { env: Env; config: Config; stderr: (text: string) => void },
  text: string,
): Promise<boolean> {
  const { env } = ctx
  if (!personPresent(ctx) || text === "") return false
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
    const code = await proc.exited
    if (code !== 0) ctx.stderr(`! pager ${command[0]} exited with ${code}\n`)
  } finally {
    open--
  }
  return true
}
