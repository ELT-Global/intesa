import { usageError } from "../output/errors"
import type { Command, Noun } from "../registry/define"

// Every top-level command, with just enough to print root help. The module itself is only
// imported when the command runs, so keep heavy imports (prompts, TUI) inside `run`.
export type NounEntry = {
  name: string
  aliases?: string[]
  summary: string
  load: () => Promise<Noun>
}

export const nouns: NounEntry[] = [
  {
    name: "api",
    summary: "Make an authenticated request to the Intesa API",
    load: () => import("./api").then((m) => m.default),
  },
  {
    name: "config",
    summary: "Get and set intesa configuration",
    load: () => import("./config").then((m) => m.default),
  },
  {
    name: "schema",
    summary: "Describe commands, flags and exit codes as JSON",
    load: () => import("./schema").then((m) => m.default),
  },
]

const named = (name: string) => (n: { name: string; aliases?: string[] }) =>
  n.name === name || Boolean(n.aliases?.includes(name))

export type Resolved = { noun: Noun; cmd?: Command; path: string[]; consumed: number }

// Turns leading words into a command. A group without a verb resolves to the group alone.
export async function resolveWords(words: string[]): Promise<Resolved> {
  const [first = "", second] = words
  const entry = nouns.find(named(first))
  if (!entry) {
    throw usageError(
      `unknown command "${first}" for "intesa"`,
      "Run `intesa --help` for a list of commands.",
    )
  }
  const noun = await entry.load()
  if (noun.kind === "command") return { noun, cmd: noun, path: [noun.name], consumed: 1 }
  if (second === undefined) return { noun, path: [noun.name], consumed: 1 }
  const cmd = noun.commands.find(named(second))
  if (!cmd) {
    throw usageError(
      `unknown command "${second}" for "intesa ${noun.name}"`,
      `Run \`intesa ${noun.name} --help\` for a list of commands.`,
    )
  }
  return { noun, cmd, path: [noun.name, cmd.name], consumed: 2 }
}

// Loads every module; only `intesa schema` needs the whole tree.
export async function allCommands() {
  const out: { cmd: Command; path: string[]; names: string[][] }[] = []
  for (const entry of nouns) {
    const noun = await entry.load()
    const own = [noun.name, ...(noun.aliases ?? [])]
    if (noun.kind === "command") out.push({ cmd: noun, path: [noun.name], names: [own] })
    else {
      for (const cmd of noun.commands) {
        out.push({
          cmd,
          path: [noun.name, cmd.name],
          names: [own, [cmd.name, ...(cmd.aliases ?? [])]],
        })
      }
    }
  }
  return out
}
