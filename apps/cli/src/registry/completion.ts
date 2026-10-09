import { named, nouns } from "../commands"
import { type Command, type Ctx, globalFlags, type Noun } from "./define"
import { type FlagSpec, flagSpecs } from "./parse"

const GLOBALS = flagSpecs(globalFlags)

// A switch that is on by default is typed as its negation, like in help.
const flagWord = (s: FlagSpec) =>
  `--${s.kind === "boolean" && s.defaultValue === true ? "no-" : ""}${s.flag}`

// The flags a command accepts as typed, global ones included. Like help, -w and -p are listed
// only where the command reads them. A group on its own has just the global flags.
export function flagWords(cmd?: Command): string[] {
  const inherited = GLOBALS.filter(
    (s) =>
      s.key !== "version" &&
      ((s.key !== "workspace" && s.key !== "project") || cmd?.context?.includes(s.key)),
  )
  return [...flagSpecs(cmd?.flags), ...inherited].map(flagWord)
}

const findFlag = (word: string, cmd?: Command) => {
  const specs = [...flagSpecs(cmd?.flags), ...GLOBALS]
  return word.startsWith("--")
    ? specs.find((s) => s.flag === word.slice(2))
    : specs.find((s) => s.short === word.slice(1))
}

type Walk = { noun?: Noun; cmd?: Command; positionals: string[]; pending?: FlagSpec }

// Reads the words typed before the cursor the way the parser would: flag values and global
// flags are skipped, then come the noun, its subcommand and the positional arguments.
// Returns undefined when a word is not a known command, so there is nothing to suggest.
async function walk(words: string[]): Promise<Walk | undefined> {
  const state: Walk = { positionals: [] }
  let afterDashes = false
  for (const word of words) {
    if (state.pending) {
      state.pending = undefined
    } else if (!afterDashes && word === "--") {
      afterDashes = true
    } else if (!afterDashes && word.startsWith("-") && word.length > 1) {
      const spec = word.includes("=") ? undefined : findFlag(word, state.cmd)
      if (spec && spec.kind !== "boolean") state.pending = spec
    } else if (!state.noun) {
      const entry = nouns.find(named(word))
      if (!entry) return undefined
      state.noun = await entry.load()
      if (state.noun.kind === "command") state.cmd = state.noun
    } else if (!state.cmd) {
      state.cmd = state.noun.kind === "group" ? state.noun.commands.find(named(word)) : undefined
      if (!state.cmd) return undefined
    } else {
      state.positionals.push(word)
    }
  }
  return state
}

const namesOf = (items: { name: string; aliases?: string[] }[]) =>
  items.flatMap((i) => [i.name, ...(i.aliases ?? [])])

// Candidates for the word being typed, given the words before it (`intesa task move WEB-1 `
// is words ["task", "move", "WEB-1"] and word ""). Sources that fail simply offer nothing.
export async function completeWords(ctx: Ctx, words: string[], word: string): Promise<string[]> {
  const state = await walk(words)
  if (!state) return []
  const matching = (candidates: readonly string[]) =>
    [...new Set(candidates)].filter((c) => c.startsWith(word))

  if (state.pending) return matching(state.pending.choices ?? [])
  if (word.startsWith("--") && word.includes("=")) {
    const name = word.slice(0, word.indexOf("="))
    return matching((findFlag(name, state.cmd)?.choices ?? []).map((c) => `${name}=${c}`))
  }
  if (word.startsWith("-")) return matching(flagWords(state.cmd))
  if (!state.noun) return matching(namesOf(nouns.filter((n) => !n.hidden)))
  if (!state.cmd) {
    return matching(state.noun.kind === "group" ? namesOf(state.noun.commands) : [])
  }

  const args = state.cmd.args ?? []
  const last = args.at(-1)
  const arg = args[state.positionals.length] ?? (last?.variadic ? last : undefined)
  if (arg?.enum) return matching(arg.enum)
  return matching((await arg?.complete?.(ctx, { word, words })) ?? [])
}
