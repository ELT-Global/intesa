import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, usageError } from "../output/errors"
import type { Env } from "../output/mode"

// Splits a command line into words; double or single quotes keep a path with spaces together.
// There are no escapes, so Windows backslashes pass through untouched.
export function splitCommand(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "")
}

// The editor command: the `editor` config key, then VISUAL, then EDITOR. Without any of them
// a person at a terminal gets the platform's plain editor; a script gets undefined, because
// guessing one would hang it.
export function editorCommand(opts: {
  env: Env
  configEditor?: string
  interactive: boolean
  platform?: string
}): string[] | undefined {
  const custom = [opts.configEditor, opts.env.VISUAL, opts.env.EDITOR].find((e) => e?.trim())
  if (custom) return splitCommand(custom)
  if (!opts.interactive) return undefined
  return [(opts.platform ?? process.platform) === "win32" ? "notepad" : "vi"]
}

// Opens `text` in the editor, in a temp file called `filename` (so syntax highlighting
// follows its extension), and returns what was saved. The editor must block until closed,
// e.g. `code --wait`.
export async function editText(
  text: string,
  opts: { filename: string; env: Env; configEditor?: string; interactive: boolean },
): Promise<string> {
  const command = editorCommand(opts)
  if (!command) {
    throw usageError(
      "no editor: set VISUAL or EDITOR, or run `intesa config set editor COMMAND`",
      "Editors that fork into the background need a wait flag, e.g. `code --wait`.",
    )
  }
  const dir = mkdtempSync(join(tmpdir(), "intesa-edit-"))
  const path = join(dir, opts.filename)
  try {
    await Bun.write(path, text)
    let code: number
    try {
      const proc = Bun.spawn([...command, path], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      code = await proc.exited
    } catch (err) {
      throw new CliError(`could not start the editor "${command[0]}": ${(err as Error).message}`, {
        code: "EDITOR_ERROR",
        exitCode: 1,
        hint: "Set VISUAL or EDITOR, or run `intesa config set editor COMMAND`.",
      })
    }
    if (code !== 0) {
      throw new CliError(`the editor exited with code ${code}; nothing was saved`, {
        code: "EDITOR_ERROR",
        exitCode: 1,
      })
    }
    return await Bun.file(path).text()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
