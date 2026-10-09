import { named, nouns } from "../commands"
import {
  type Command,
  type Ctx,
  type FlagSpec,
  flagSpecs,
  GLOBAL_SPECS,
  type Globals,
  inheritedFlags,
  type Noun,
  negationOnly,
} from "./define"

// A switch that is on by default is typed as its negation, like in help.
const flagWord = (s: FlagSpec) => `--${negationOnly(s) ? "no-" : ""}${s.flag}`

// The flags a command accepts as typed, global ones included, as its help lists them. A group
// on its own has just the global flags.
export const flagWords = (cmd?: Command) =>
  [...flagSpecs(cmd?.flags), ...inheritedFlags(cmd)].map(flagWord)

const findFlag = (word: string, cmd?: Command) => {
  const specs = [...flagSpecs(cmd?.flags), ...GLOBAL_SPECS]
  return word.startsWith("--")
    ? specs.find((s) => s.flag === word.slice(2))
    : specs.find((s) => s.short === word.slice(1))
}

// What the line says about where to look things up: -w, -p and --host.
type Typed = Partial<Pick<Globals, "workspace" | "project" | "host">>

type Walk = {
  noun?: Noun
  cmd?: Command
  positionals: string[]
  pending?: FlagSpec
  typed: Typed
}

// Reads the words typed before the cursor the way the parser would: flag values and global
// flags are skipped, then come the noun, its subcommand and the positional arguments.
// Returns undefined when a word is not a known command, so there is nothing to suggest.
async function walk(words: string[]): Promise<Walk | undefined> {
  const state: Walk = { positionals: [], typed: {} }
  const keep = (spec: FlagSpec | undefined, value: string) => {
    if (spec?.key === "workspace" || spec?.key === "project" || spec?.key === "host") {
      state.typed[spec.key] = value
    }
  }
  let afterDashes = false
  for (const word of words) {
    if (state.pending) {
      keep(state.pending, word)
      state.pending = undefined
    } else if (!afterDashes && word === "--") {
      afterDashes = true
    } else if (!afterDashes && word.startsWith("-") && word.length > 1) {
      const at = word.indexOf("=")
      const spec = findFlag(at < 0 ? word : word.slice(0, at), state.cmd)
      if (at >= 0) keep(spec, word.slice(at + 1))
      else if (spec && spec.kind !== "boolean") state.pending = spec
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
// is words ["task", "move", "WEB-1"] and word ""). Values looked up on the server get a
// context made from the -w, -p and --host on the line. Sources that fail simply offer
// nothing.
export async function completeWords(
  words: string[],
  word: string,
  ctxFor: (typed: Typed) => Ctx,
): Promise<string[]> {
  const state = await walk(words)
  if (!state) return []
  const matching = (candidates: readonly string[]) =>
    [...new Set(candidates)].filter((c) => c.startsWith(word))

  // The values of a flag: its choices, else what its source offers. Sources match the word
  // themselves; a repeatable flag also takes a comma list, so only the part after the last
  // comma is completed.
  const flagValues = async (spec: FlagSpec | undefined, typed: string) => {
    if (spec?.choices) return [...new Set(spec.choices)].filter((c) => c.startsWith(typed))
    if (!spec?.complete) return []
    const source = spec.complete
    const head = spec.multiple ? typed.slice(0, typed.lastIndexOf(",") + 1) : ""
    const tail = typed.slice(head.length)
    const found = await (async () => source(ctxFor(state.typed), { word: tail, words }))().catch(
      () => [],
    )
    return [...new Set(found)].map((c) => head + c)
  }
  if (state.pending) return flagValues(state.pending, word)
  if (word.startsWith("--") && word.includes("=")) {
    const at = word.indexOf("=")
    const values = await flagValues(findFlag(word.slice(0, at), state.cmd), word.slice(at + 1))
    return values.map((v) => `${word.slice(0, at)}=${v}`)
  }
  if (word.startsWith("-")) return matching(flagWords(state.cmd))
  if (!state.noun) return matching(namesOf(nouns))
  if (!state.cmd) {
    return matching(state.noun.kind === "group" ? namesOf(state.noun.commands) : [])
  }

  const args = state.cmd.args ?? []
  const last = args.at(-1)
  const arg = args[state.positionals.length] ?? (last?.variadic ? last : undefined)
  if (arg?.enum) return matching(arg.enum)
  const source = arg?.complete
  if (!source) return []
  // Sources match the word themselves, e.g. keys in any case.
  const found = await (async () => source(ctxFor(state.typed), { word, words }))().catch(() => [])
  return [...new Set(found)]
}

// `intesa __complete --word=<partial> -- <words before it>`, as the completion scripts call
// it; a missing --word is an empty one. Prints one candidate per line.
export async function complete(argv: string[], ctxFor: (typed: Typed) => Ctx): Promise<string> {
  const dashes = argv.indexOf("--")
  const before = dashes < 0 ? argv : argv.slice(0, dashes)
  const words = dashes < 0 ? [] : argv.slice(dashes + 1)
  const flag = before.findLast((a) => a.startsWith("--word="))
  const found = await completeWords(words, flag?.slice("--word=".length) ?? "", ctxFor)
  return found.map((c) => `${c}\n`).join("")
}
