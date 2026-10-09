import { styleText } from "node:util"
import { EXIT_CODES } from "../output/errors"
import { FIELD_SETS } from "../output/render"
import {
  type Arg,
  type Command,
  type FlagSpec,
  flagSpecs,
  GLOBAL_SPECS as GLOBALS,
  type Group,
  inheritedFlags,
  negationOnly,
} from "./define"

export type NounSummary = { name: string; aliases?: string[]; summary: string }

const ENVIRONMENT: [string, string][] = [
  ["INTESA_TOKEN", "Token to use instead of stored credentials (CI and agents)"],
  ["INTESA_HOST", "Server to use, like --host"],
  ["INTESA_WORKSPACE", "Workspace slug to use, like --workspace"],
  ["INTESA_PROJECT", "Project key to use, like --project"],
  [
    "INTESA_CONFIG_DIR",
    "Config directory (default %APPDATA%\\intesa, $XDG_CONFIG_HOME/intesa or ~/.config/intesa)",
  ],
  ["INTESA_SECRETS", "Set to `file` to keep tokens in hosts.json instead of the system keychain"],
  ["INTESA_PROMPT_DISABLED, CI", "Never prompt; missing input fails with exit code 2"],
  ["INTESA_FORCE_TTY", "Format output for a terminal even when piped; a number sets the width"],
  ["NO_COLOR, CLICOLOR=0", "Disable color"],
  ["CLICOLOR_FORCE", "Enable color even when piped"],
  ["INTESA_DEBUG", "`1` logs HTTP requests to stderr; `api` also logs headers and bodies"],
  ["INTESA_HTTP_TIMEOUT_MS", "How long a request may take before it fails (default 30000)"],
  ["INTESA_PAGER, PAGER", "Pager for long output"],
  ["VISUAL, EDITOR", "Editor for long text, at a terminal"],
  ["INTESA_EDITOR", "Editor for intesa only, used even without a terminal"],
  ["BROWSER", "Browser for opening links"],
]

export const HELP_TOPICS: NounSummary[] = [
  { name: "environment", summary: "Environment variables that change how intesa behaves" },
  { name: "exit-codes", summary: "What each exit code means" },
]

const LEARN_MORE = [
  "Use `intesa <command> <subcommand> --help` for more information about a command.",
  "Use `intesa schema` for a JSON description of every command, and",
  "`intesa help exit-codes` for what each exit code means.",
]

type Section = [title: string, lines: string[]]

function sections(intro: string, parts: Section[], color: boolean) {
  const heading = (t: string) => (color ? styleText("bold", t) : t)
  const body = parts
    .filter(([, lines]) => lines.length > 0)
    .map(
      ([title, lines]) => `${heading(title)}\n${lines.map((l) => `  ${l}`.trimEnd()).join("\n")}`,
    )
  return `${[intro, ...body].join("\n\n")}\n`
}

// Two aligned columns, e.g. `name:  summary` or `-X, --method string  HTTP method`.
function columns(rows: [string, string][]) {
  const width = Math.max(0, ...rows.map(([left]) => Bun.stringWidth(left)))
  return rows.map(([left, right]) => `${left.padEnd(width)}  ${right}`)
}

const list = (items: NounSummary[]) => columns(items.map((i) => [`${i.name}:`, i.summary]))

function flagRows(specs: FlagSpec[]): string[] {
  return columns(
    specs.map((s) => {
      // A boolean that defaults to on is documented by the form that turns it off.
      const name = negationOnly(s) ? `no-${s.flag}` : s.flag
      const value =
        s.kind === "boolean"
          ? ""
          : ` ${s.placeholder ?? (s.kind === "number" ? "number" : "string")}${s.multiple ? "..." : ""}`
      const choices = s.choices ? `: {${s.choices.join("|")}}` : ""
      const fallback = s.required
        ? " (required)"
        : s.kind !== "boolean" && s.defaultValue !== undefined && !Array.isArray(s.defaultValue)
          ? ` (default ${JSON.stringify(s.defaultValue)})`
          : ""
      return [
        `${s.short ? `-${s.short}, ` : "    "}--${name}${value}`,
        `${s.description ?? ""}${choices}${fallback}`,
      ]
    }),
  )
}

export function argUsage(args: readonly Arg[] = []) {
  return args
    .map((a) => {
      const name = `<${a.name}>${a.variadic ? "..." : ""}`
      return a.required ? name : `[${name}]`
    })
    .join(" ")
}

const examples = (lines: string[] = []) => lines.map((e) => `$ ${e}`)

export function rootHelp(nouns: NounSummary[], color: boolean) {
  return sections(
    "Work with Intesa from the command line.",
    [
      ["USAGE", ["intesa <command> <subcommand> [flags]"]],
      ["COMMANDS", list(nouns)],
      ["HELP TOPICS", list(HELP_TOPICS)],
      ["FLAGS", flagRows(GLOBALS)],
      [
        "EXAMPLES",
        examples([
          "intesa config set host https://pm.example.com",
          "intesa api /me",
          "intesa schema config",
        ]),
      ],
      ["LEARN MORE", LEARN_MORE],
    ],
    color,
  )
}

const aliasLines = (path: string[], aliases: string[] = []) =>
  aliases.map((a) => ["intesa", ...path.slice(0, -1), a].join(" "))

export function groupHelp(group: Group, color: boolean) {
  return sections(
    group.description ?? group.summary,
    [
      ["USAGE", [`intesa ${group.name} <command> [flags]`]],
      ["ALIASES", aliasLines([group.name], group.aliases)],
      ["AVAILABLE COMMANDS", list(group.commands)],
      ["INHERITED FLAGS", flagRows(GLOBALS.filter((s) => s.key === "help"))],
      ["EXAMPLES", examples(group.examples)],
      ["LEARN MORE", LEARN_MORE],
    ],
    color,
  )
}

export function commandHelp(cmd: Command, path: string[], color: boolean) {
  const usage = ["intesa", ...path, argUsage(cmd.args), "[flags]"].filter(Boolean).join(" ")
  const described = (cmd.args ?? []).filter((a) => a.description)
  const output = cmd.output ? FIELD_SETS[cmd.output].fields.join(", ") : undefined
  return sections(
    cmd.description ?? cmd.summary,
    [
      ["USAGE", [usage]],
      ["ALIASES", aliasLines(path, cmd.aliases)],
      ["ARGUMENTS", columns(described.map((a) => [`<${a.name}>`, a.description ?? ""]))],
      ["FLAGS", flagRows(flagSpecs(cmd.flags))],
      ["INHERITED FLAGS", flagRows(inheritedFlags(cmd))],
      ["JSON FIELDS", output ? [output] : []],
      ["EXAMPLES", examples(cmd.examples)],
      ["LEARN MORE", LEARN_MORE],
    ],
    color,
  )
}

export function topicHelp(name: string, color: boolean): string | undefined {
  if (name === "exit-codes") {
    return sections(
      "intesa exits with one of these codes. With --json, failures also print\n" +
        '{"error":{"code","message","exitCode"}} on stderr; stdout only ever carries data.',
      [["EXIT CODES", EXIT_CODES.map((e) => `${e.code}  ${e.name.padEnd(10)}  ${e.meaning}`)]],
      color,
    )
  }
  if (name === "environment") {
    return sections(
      "Environment variables that change how intesa behaves.",
      [["VARIABLES", columns(ENVIRONMENT)]],
      color,
    )
  }
  return undefined
}
