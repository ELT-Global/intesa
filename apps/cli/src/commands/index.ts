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
    name: "auth",
    summary: "Sign in to and out of Intesa servers",
    load: () => import("./auth").then((m) => m.default),
  },
  {
    name: "workspace",
    aliases: ["ws"],
    summary: "List, create and switch workspaces",
    load: () => import("./workspace").then((m) => m.default),
  },
  {
    name: "project",
    aliases: ["p"],
    summary: "List, create and manage projects",
    load: () => import("./project").then((m) => m.default),
  },
  {
    name: "task",
    aliases: ["t"],
    summary: "List, create, edit and move tasks",
    load: () => import("./task").then((m) => m.default),
  },
  {
    name: "board",
    summary: "Open a project's board full screen",
    load: () => import("./board").then((m) => m.default),
  },
  {
    name: "member",
    summary: "List, add and manage workspace members",
    load: () => import("./member").then((m) => m.default),
  },
  {
    name: "tag",
    summary: "List, create and manage tags",
    load: () => import("./tag").then((m) => m.default),
  },
  {
    name: "field",
    summary: "List, create and manage a project's custom fields",
    load: () => import("./field").then((m) => m.default),
  },
  {
    name: "artifact",
    aliases: ["a"],
    summary: "List, upload, download and edit a task's artifacts",
    load: () => import("./artifact").then((m) => m.default),
  },
  {
    name: "status",
    summary: "Show your recent projects, your tasks and what is due soon",
    load: () => import("./status").then((m) => m.default),
  },
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
  {
    name: "token",
    summary: "Manage API tokens",
    load: () => import("./token").then((m) => m.default),
  },
  {
    name: "me",
    summary: "View and edit your account, including two-factor sign-in",
    load: () => import("./me").then((m) => m.default),
  },
  {
    name: "completion",
    summary: "Generate a shell completion script",
    load: () => import("./completion").then((m) => m.default),
  },
  {
    name: "mcp",
    summary: "Serve intesa's commands to AI agents as MCP tools",
    load: () => import("./mcp").then((m) => m.default),
  },
]

export const named = (name: string) => (n: { name: string; aliases?: string[] }) =>
  n.name === name || Boolean(n.aliases?.includes(name))

export type Resolved = {
  noun: Noun
  cmd?: Command
  path: string[]
  consumed: number
  // The group was named alone and its default command was chosen; `--help` still means the group.
  viaDefault?: boolean
}

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
  if (second === undefined) {
    const fallback = noun.commands.find(named(noun.defaultCommand ?? ""))
    if (!fallback) return { noun, path: [noun.name], consumed: 1 }
    return { noun, cmd: fallback, path: [noun.name, fallback.name], consumed: 1, viaDefault: true }
  }
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
