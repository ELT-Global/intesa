import { realpathSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { CliError, type ExitCode, usageError } from "../output/errors"
import type { Env } from "../output/mode"
import { FIELD_SETS } from "../output/render"
import type { Command, Io } from "../registry/define"
import { flagsSchema } from "../registry/schema"

// How each command is offered as a tool:
//   excluded     not a tool
//   read         changes nothing, here or on the server
//   write        changes something
//   idempotent   changes something, ending in the same state however often it runs
//   destructive  cannot be undone (deletes, or overwrites a file or stored content), so it
//                needs confirm: true
// A command missing here is not offered at all; the tests fail until it is placed.
export type ToolKind = "excluded" | "read" | "write" | "idempotent" | "destructive"

export const TOOL_KINDS: Record<string, ToolKind> = {
  // A full-screen UI, shell setup, this server and the schema the tool list already is.
  board: "excluded",
  completion: "excluded",
  mcp: "excluded",
  schema: "excluded",
  // Sign-in and anything that mints, prints or weakens credentials; `api` can send any
  // request, those included, and read local files into it.
  "auth login": "excluded",
  "auth logout": "excluded",
  "auth token": "excluded",
  "token create": "excluded",
  "me 2fa": "excluded",
  api: "excluded",
  // Defaults that would change the person's own CLI behind their back.
  "config set": "excluded",
  "workspace use": "excluded",
  "project use": "excluded",
  // What only opens a browser or an editor.
  "task open": "excluded",
  "artifact edit": "excluded",

  "auth status": "read",
  "workspace list": "read",
  "workspace view": "read",
  "project list": "read",
  "project view": "read",
  "task list": "read",
  "task view": "read",
  "task history": "read",
  "task search": "read",
  "task url": "read",
  "member list": "read",
  "tag list": "read",
  "field list": "read",
  "artifact list": "read",
  "artifact view": "read",
  status: "read",
  "config get": "read",
  "config list": "read",
  "token list": "read",
  "me view": "read",

  "workspace create": "write",
  "project create": "write",
  "task create": "write",
  "task link": "write",
  "member add": "write",
  "tag create": "write",
  "field create": "write",
  "artifact upload": "write",

  "workspace rename": "idempotent",
  "project edit": "idempotent",
  "task edit": "idempotent",
  "task move": "idempotent",
  "task start": "idempotent",
  "task review": "idempotent",
  "task done": "idempotent",
  "task assign": "idempotent",
  "task unassign": "idempotent",
  "task unlink": "idempotent",
  "member role": "idempotent",
  "tag edit": "idempotent",
  "field edit": "idempotent",
  "me edit": "idempotent",

  "project delete": "destructive",
  "task delete": "destructive",
  "member remove": "destructive",
  "member leave": "destructive",
  "tag delete": "destructive",
  "field delete": "destructive",
  "token revoke": "destructive",
  // Writes to any local path, replacing a file with --force.
  "artifact download": "destructive",
  "artifact replace": "destructive",
}

// Inputs that name a local file the command reads or writes.
const isPathInput = (name: string) => name === "file" || name === "output" || name.endsWith("-file")

type JsonSchema = Record<string, unknown> & { type?: unknown }

export type ToolDefinition = {
  name: string
  title: string
  description: string
  inputSchema: { type: "object"; properties: Record<string, JsonSchema>; required?: string[] }
  annotations: {
    title: string
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

export type Tool = {
  cmd: Command
  path: string[]
  definition: ToolDefinition
}

export type ToolResult = {
  content: { type: "text"; text: string }[]
  isError: boolean
}

// Global flags as tool inputs: -w and -p where the command reads them, --dry-run on mutations.
const SHARED: Record<string, JsonSchema> = {
  workspace: { type: "string", description: "Workspace slug, when not the default one" },
  project: { type: "string", description: "Project key, when not the default one" },
  "dry-run": {
    type: "boolean",
    default: false,
    description: "Return the request as {method, path, body} instead of sending it",
  },
}

// `short` and `placeholder` only matter to help; strict schema validators reject unknown keys.
function clean(schema: JsonSchema): JsonSchema {
  const { short: _s, placeholder: _p, ...rest } = schema
  return rest
}

const kindOf = (path: string[]): ToolKind => TOOL_KINDS[path.join(" ")] ?? "excluded"
const isDestructive = (path: string[]) => kindOf(path) === "destructive"

function inputSchema(cmd: Command, path: string[], read: boolean, destructive: boolean) {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  const add = (name: string, schema: JsonSchema) => {
    // Arguments, flags and the shared inputs live in one object, so a name may mean one thing.
    if (name in properties) throw new Error(`${path.join(" ")}: "${name}" is used twice`)
    properties[name] = schema
  }
  for (const a of cmd.args ?? []) {
    const value: JsonSchema = a.enum ? { type: "string", enum: [...a.enum] } : { type: "string" }
    const description = a.description ? { description: a.description } : {}
    add(
      a.name,
      a.variadic
        ? { type: "array", items: value, ...(a.required ? { minItems: 1 } : {}), ...description }
        : { ...value, ...description },
    )
    if (a.required) required.push(a.name)
  }
  const flags = flagsSchema(cmd.flags) as {
    properties?: Record<string, JsonSchema>
    required?: string[]
  }
  for (const [name, schema] of Object.entries(flags.properties ?? {})) add(name, clean(schema))
  required.push(...(flags.required ?? []))

  for (const name of cmd.context ?? []) add(name, SHARED[name] as JsonSchema)
  if (cmd.output) {
    add("fields", {
      type: "array",
      items: { type: "string", enum: [...FIELD_SETS[cmd.output].fields] },
      description: "Only these output fields",
    })
  }
  if (!read) add("dry-run", SHARED["dry-run"] as JsonSchema)
  if (destructive) {
    add("confirm", {
      type: "boolean",
      default: false,
      description: "Must be true to go ahead; nothing can be undone",
    })
  }
  return {
    type: "object" as const,
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function describe(cmd: Command, path: string[], destructive: boolean) {
  const examples = cmd.examples ?? []
  return [
    `${cmd.summary}.`,
    cmd.description,
    `Runs \`intesa ${path.join(" ")}\`; arguments are its arguments and flags by name.`,
    destructive ? "Needs confirm: true, or dry-run: true to see the request instead." : undefined,
    examples.length > 0 ? `Examples:\n${examples.map((e) => `  ${e}`).join("\n")}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n")
}

// One tool per command an agent can use, named by its words: `task list` is `task_list`.
export function buildTools(commands: { cmd: Command; path: string[] }[]): Tool[] {
  return commands
    .filter(({ path }) => kindOf(path) !== "excluded")
    .map(({ cmd, path }) => {
      const kind = kindOf(path)
      const read = kind === "read"
      const destructive = kind === "destructive"
      return {
        cmd,
        path,
        definition: {
          name: path.join("_"),
          title: cmd.summary,
          description: describe(cmd, path, destructive),
          inputSchema: inputSchema(cmd, path, read, destructive),
          annotations: {
            title: cmd.summary,
            readOnlyHint: read,
            destructiveHint: destructive,
            idempotentHint: kind !== "write",
            openWorldHint: false,
          },
        },
      }
    })
}

const scalar = (name: string, value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  throw usageError(`"${name}" must be a string or a number`)
}

const list = (name: string, value: unknown) =>
  (Array.isArray(value) ? value : [value]).map((v) => scalar(name, v))

const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

// Whether a path is the config directory or inside it, where the stored token may live.
function inConfigDir(path: string, local: Local) {
  const rel = relative(real(resolve(local.configDir)), real(resolve(local.cwd, path)))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

export type Local = { cwd: string; configDir: string }

// The command line a call stands for: the command words, its flags as `--flag=value` (so a
// value may start with "-"), `--json`, then the positionals after `--`. `defaults` (the
// server's own -w/-p/--host) come first and give way to the call's own. With `local`, files
// in the config directory are refused, so a tool can neither upload nor overwrite them.
export function toArgv(
  tool: Tool,
  input: unknown,
  defaults: Record<string, string>,
  local?: Local,
): string[] {
  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input)))
    throw usageError("arguments must be an object")
  const values = (input ?? {}) as Record<string, unknown>
  const { properties } = tool.definition.inputSchema
  const unknown = Object.keys(values).find((k) => !(k in properties))
  if (unknown) {
    throw usageError(
      `unknown argument "${unknown}" for ${tool.definition.name}`,
      `It takes: ${Object.keys(properties).join(", ") || "no arguments"}.`,
    )
  }

  const words = tool.path.join(" ")
  const destructive = isDestructive(tool.path)
  if (destructive && values.confirm !== true && values["dry-run"] !== true) {
    throw usageError(
      `${tool.definition.name} cannot be undone and was not run`,
      "Call it again with confirm: true, or dry-run: true to see the request.",
    )
  }
  // `-o -` writes the file to stdout, which here is the protocol itself.
  if (words === "artifact download" && values.output === "-") {
    throw usageError('output "-" is not available here', "Give a file or directory path.")
  }
  for (const [name, value] of Object.entries(values)) {
    if (!local || !isPathInput(name)) continue
    for (const path of value === undefined || value === null ? [] : list(name, value)) {
      if (path !== "-" && inConfigDir(path, local)) {
        throw usageError(
          `"${name}" names a file in intesa's config directory, which tools may not use`,
          "It holds the CLI's settings and may hold its credentials.",
        )
      }
    }
  }

  const positionals: string[] = []
  let gap: string | undefined
  for (const a of tool.cmd.args ?? []) {
    const value = values[a.name]
    if (value === undefined || value === null) {
      gap ??= a.name
      continue
    }
    if (gap) throw usageError(`"${a.name}" needs "${gap}" as well`)
    if (a.variadic) positionals.push(...list(a.name, value))
    else positionals.push(scalar(a.name, value))
  }

  const argNames = new Set((tool.cmd.args ?? []).map((a) => a.name))
  const flags: string[] = []
  for (const [name, value] of Object.entries(values)) {
    if (argNames.has(name) || name === "confirm" || value === undefined) continue
    if (name === "fields") {
      flags.push(`--fields=${list(name, value).join(",")}`)
      continue
    }
    const type = properties[name]?.type
    const types = Array.isArray(type) ? type : [type]
    if (value === null) {
      if (!types.includes("null")) throw usageError(`"${name}" cannot be null`)
      flags.push(`--no-${name}`)
    } else if (types.includes("boolean")) {
      if (typeof value !== "boolean") throw usageError(`"${name}" must be true or false`)
      if (value) flags.push(`--${name}`)
    } else {
      for (const v of types.includes("array") ? list(name, value) : [scalar(name, value)]) {
        flags.push(`--${name}=${v}`)
      }
    }
  }
  if (values.confirm === true) flags.push("--yes")

  // The server's project belongs to the server's workspace, so a call naming its own
  // workspace does not get it.
  const inherited = Object.entries(defaults)
    .filter(([name]) => values[name] === undefined)
    .filter(([name]) => name !== "project" || values.workspace === undefined)
    .map(([name, value]) => `--${name}=${value}`)
  return [...tool.path, ...inherited, ...flags, "--json", "--", ...positionals]
}

const text = (t: string) => ({ type: "text" as const, text: t })

const errorJson = (e: CliError) => JSON.stringify({ error: e.toJSON() })

// The `{"error": …}` line a failed --json run writes to stderr, and everything else it wrote.
function splitStderr(stderr: string) {
  let envelope: string | undefined
  const notes: string[] = []
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      if (JSON.parse(line)?.error) {
        envelope = line
        continue
      }
    } catch {}
    notes.push(line)
  }
  return { envelope, notes: notes.join("\n") }
}

// Runs the command in this process with its output captured and nothing able to prompt, open
// an editor or read stdin (which carries the protocol). The result's text is the --json
// output; a failure carries the error envelope instead, then any partial output. Warnings and
// confirmations the command wrote to stderr follow as a last item.
export async function callTool(
  tool: Tool,
  input: unknown,
  opts: {
    invoke: (argv: string[], env: Env, io: Io) => Promise<number>
    env: Env
    defaults: Record<string, string>
    local: Local
    log?: (text: string) => void
  },
): Promise<ToolResult> {
  let argv: string[]
  try {
    argv = toArgv(tool, input, opts.defaults, opts.local)
  } catch (err) {
    if (!(err instanceof CliError)) throw err
    return { content: [text(errorJson(err))], isError: true }
  }
  let stdout = ""
  let stderr = ""
  const exitCode = await opts.invoke(argv, opts.env, {
    stdout: (t) => {
      stdout += t
    },
    stderr: (t) => {
      stderr += t
    },
    readStdin: () =>
      Promise.reject(usageError("stdin is not available to tools; pass the content instead")),
  })
  opts.log?.(`intesa ${argv.join(" ")} → exit ${exitCode}\n${stderr}`)

  const out = stdout.trimEnd()
  const { envelope, notes } = splitStderr(stderr)
  if (exitCode === 0) {
    return {
      content: [text(out || notes || "Done."), ...(out && notes ? [text(notes)] : [])],
      isError: false,
    }
  }
  const error =
    envelope ??
    errorJson(
      new CliError(notes || `exited with code ${exitCode}`, {
        code: "INTERNAL",
        exitCode: exitCode as ExitCode,
      }),
    )
  return {
    content: [
      text(error),
      ...(out ? [text(out)] : []),
      ...(notes && envelope ? [text(notes)] : []),
    ],
    isError: true,
  }
}

// Tool calls never prompt (no terminal is theirs anyway) and never start an editor, whose
// output would land on the protocol's stdout.
export function toolEnv(env: Env): Env {
  const { INTESA_EDITOR: _editor, INTESA_FORCE_TTY: _tty, CLICOLOR_FORCE: _color, ...rest } = env
  return { ...rest, INTESA_PROMPT_DISABLED: "1" }
}
