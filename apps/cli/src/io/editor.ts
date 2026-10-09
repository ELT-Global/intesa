import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cliError, usageError } from "../output/errors"
import type { Env } from "../output/mode"
import { splitCommand } from "./command"

// The editor command. INTESA_EDITOR is set on purpose for intesa alone, so it is used even
// without a terminal (tests, scripted edits). Otherwise only a person at a terminal gets one:
// the `editor` config key, then VISUAL, then EDITOR, else the platform's plain editor. A
// script gets undefined, because an editor inherited from someone's shell (`code --wait`)
// would hang it.
export function editorCommand(opts: {
  env: Env
  configEditor?: string
  interactive: boolean
  platform?: string
}): string[] | undefined {
  if (opts.env.INTESA_EDITOR?.trim()) return splitCommand(opts.env.INTESA_EDITOR)
  if (!opts.interactive) return undefined
  const custom = [opts.configEditor, opts.env.VISUAL, opts.env.EDITOR].find((e) => e?.trim())
  if (custom) return splitCommand(custom)
  return [(opts.platform ?? process.platform) === "win32" ? "notepad" : "vi"]
}

// How many editors are open. While one has the terminal, Ctrl+C belongs to it, so main does
// not exit on SIGINT then.
let open = 0
export const editing = () => open > 0

// Opens `text` in the editor, in a temp file named after `filename` (so syntax highlighting
// follows its extension), and returns what was saved. The editor must block until closed,
// e.g. `code --wait`.
export async function editText(
  text: string,
  opts: { filename: string; env: Env; configEditor?: string; interactive: boolean },
): Promise<string> {
  const command = editorCommand(opts)
  if (!command) {
    throw usageError(
      "no editor without a terminal",
      "Set INTESA_EDITOR to edit from a script; editors that fork need a wait flag (`code --wait`).",
    )
  }
  const dir = mkdtempSync(join(tmpdir(), "intesa-edit-"))
  // Only plain characters: a `.cmd` editor on Windows would read & % ^ in the path as syntax.
  const path = join(dir, opts.filename.replace(/[^\w.-]+/g, "_"))
  try {
    await Bun.write(path, text)
    let code: number
    open++
    try {
      const proc = Bun.spawn([...command, path], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      code = await proc.exited
    } catch (err) {
      throw cliError(
        "EDITOR_ERROR",
        `could not start the editor "${command[0]}": ${(err as Error).message}`,
        "Set VISUAL or EDITOR, or run `intesa config set editor COMMAND`.",
      )
    } finally {
      open--
    }
    if (code !== 0) {
      throw cliError("EDITOR_ERROR", `the editor exited with code ${code}; nothing was saved`)
    }
    return await Bun.file(path).text()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
