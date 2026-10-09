import { usageError } from "../output/errors"
import type { Ctx } from "../registry/define"

// A file named by a flag, or stdin for `-`.
export async function readInput(ctx: Ctx, path: string, flag: string): Promise<string> {
  if (path === "-") return ctx.readStdin()
  const file = Bun.file(path)
  if (!(await file.exists())) throw usageError(`${flag}: no such file "${path}"`)
  return file.text()
}

// `NAME=VALUE` from a repeatable flag; the value may contain `=` itself.
export function splitPair(entry: string, flag: string): [string, string] {
  const at = entry.indexOf("=")
  if (at <= 0) throw usageError(`${flag} expects NAME=VALUE, got "${entry}"`)
  return [entry.slice(0, at), entry.slice(at + 1)]
}
