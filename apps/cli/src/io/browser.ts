import type { Env } from "../output/mode"
import type { Ctx } from "../registry/define"
import { splitCommand } from "./command"
import { personPresent } from "./prompt"

// The command that opens a URL: BROWSER, then the `browser` config key, then the platform's
// opener. rundll32 rather than `cmd /c start`, which would need `&` in URLs escaped.
export function browserCommand(
  url: string,
  opts: { env: Env; configBrowser?: string; platform?: string },
): string[] {
  const custom = opts.env.BROWSER || opts.configBrowser
  if (custom?.trim()) return [...splitCommand(custom), url]
  const platform = opts.platform ?? process.platform
  if (platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler", url]
  if (platform === "darwin") return ["open", url]
  return ["xdg-open", url]
}

// Starts the browser without waiting for it. Returns false when it could not be started;
// callers always print the URL as well, so that is not an error.
export function openBrowser(url: string, opts: { env: Env; configBrowser?: string }): boolean {
  try {
    const proc = Bun.spawn(browserCommand(url, opts), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    proc.unref()
    return true
  } catch {
    return false
  }
}

// Opens `url` when a person is there to see it, and says on stderr where to go either way.
// `purpose` finishes "Open URL in your browser…", e.g. " to approve this sign-in".
export function openOrPrint(ctx: Ctx, url: string, purpose = ""): boolean {
  const opened =
    personPresent(ctx) && openBrowser(url, { env: ctx.env, configBrowser: ctx.config.browser })
  ctx.stderr(
    opened ? `Opening ${url} in your browser…\n` : `Open ${url} in your browser${purpose}.\n`,
  )
  return opened
}
