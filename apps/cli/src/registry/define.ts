import { z } from "zod"
import type { ResolvedContext } from "../client/context"
import type { Http } from "../client/http"
import type { Config } from "../config/config"
import type { Env, Mode } from "../output/mode"
import type { OutputName } from "../output/render"

declare module "zod" {
  interface GlobalMeta {
    // One-letter alias, e.g. `-X` for `--method`.
    short?: string
    // Value name shown in help, e.g. `--input file`.
    placeholder?: string
  }
}

export const globalFlags = z.object({
  workspace: z
    .string()
    .optional()
    .meta({ short: "w", placeholder: "slug", description: "Workspace to use" }),
  project: z
    .string()
    .optional()
    .meta({ short: "p", placeholder: "KEY", description: "Project to use" }),
  host: z.string().optional().meta({ placeholder: "url", description: "Intesa server to use" }),
  json: z.boolean().default(false).meta({ description: "Print JSON; errors go to stderr as JSON" }),
  fields: z
    .string()
    .optional()
    .meta({ placeholder: "a,b", description: "Only these output fields (JSON and tables)" }),
  quiet: z.boolean().default(false).meta({ short: "q", description: "Print only keys or IDs" }),
  yes: z.boolean().default(false).meta({ description: "Skip confirmations" }),
  dryRun: z
    .boolean()
    .default(false)
    .meta({ description: "Print mutations as {method, path, body} instead of sending them" }),
  // On by default, so only `--no-color` exists; `--color` is free for commands (tag colours).
  color: z.boolean().default(true).meta({ description: "Disable colored output" }),
  debug: z.boolean().default(false).meta({ description: "Log HTTP requests to stderr" }),
  help: z.boolean().default(false).meta({ short: "h", description: "Show help for command" }),
  version: z.boolean().default(false).meta({ description: "Show intesa version" }),
})
export type Globals = z.infer<typeof globalFlags>

export type Arg = {
  name: string
  required?: boolean
  // Takes all remaining positionals; must be last.
  variadic?: boolean
  enum?: readonly string[]
  description?: string
  // Candidates for shell completion: `word` is what has been typed of this argument and
  // `words` everything typed before it. Errors are swallowed, so a source may just throw.
  complete?: (ctx: Ctx, input: { word: string; words: string[] }) => string[] | Promise<string[]>
}

type ArgValues<A extends readonly Arg[]> = {
  [K in A[number] as K["name"]]: K extends { variadic: true }
    ? string[]
    : K extends { required: true }
      ? string
      : string | undefined
}

export type Ctx = {
  globals: Globals
  env: Env
  cwd: string
  mode: Mode
  configDir: string
  config: Config
  context: () => ResolvedContext
  // Lazily resolves the host and credentials; commands that never call it work offline.
  http: () => Promise<Http>
  stdout: (text: string) => void
  stderr: (text: string) => void
  // A confirmation for people, like "✓ Deleted WEB-12": on stderr, and not with -q.
  done: (message: string) => void
  readStdin: () => Promise<string>
}

type AnyFlags = z.ZodObject

export type Command<
  A extends readonly Arg[] = readonly Arg[],
  F extends AnyFlags = AnyFlags,
  R = unknown,
> = {
  kind: "command"
  name: string
  aliases?: string[]
  summary: string
  description?: string
  args?: A
  flags?: F
  // Which of -w / -p the command reads; only those are listed in its help.
  context?: readonly ("workspace" | "project")[]
  // Field set for --fields, -q, table columns and `intesa schema`.
  output?: OutputName
  examples?: string[]
  // A returned value is printed according to --json / --fields / -q / the output field set.
  run: (ctx: Ctx, args: ArgValues<A>, flags: z.output<F>) => R
  // How the result reads without --json, -q or --fields, instead of the default table.
  human?: (
    ctx: Ctx,
    data: Exclude<Awaited<R>, undefined>,
    flags: z.output<F>,
  ) => string | Promise<string>
}

export type Group = {
  kind: "group"
  name: string
  aliases?: string[]
  summary: string
  description?: string
  commands: Command[]
  // Runs when the group is named without a subcommand (`intesa me`); otherwise its help prints.
  defaultCommand?: string
  examples?: string[]
}

export type Noun = Command | Group

export function defineCommand<
  const A extends readonly Arg[] = [],
  F extends AnyFlags = z.ZodObject<Record<never, never>>,
  R = unknown,
>(def: Omit<Command<A, F, R>, "kind">): Command {
  // A command flag shadowing a global one would silently change what the global means.
  const taken = new Set(GLOBAL_SPECS.flatMap((s) => spelled(s, "global")))
  const clash = flagSpecs(def.flags)
    .flatMap((s) => spelled(s, "command"))
    .find((n) => taken.has(n))
  if (clash) throw new Error(`${def.name}: flag ${clash} is already a global flag`)
  return { kind: "command", ...def } as unknown as Command
}

export const defineGroup = (def: Omit<Group, "kind">): Group => ({ kind: "group", ...def })

export const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

// Metadata may sit on a wrapper (`.optional().meta()`) or the inner type (`.meta().optional()`).
export function metaOf(schema: z.ZodType): z.GlobalMeta {
  let current: z.ZodType | undefined = schema
  let meta: z.GlobalMeta = {}
  while (current) {
    meta = { ...current.meta(), ...meta }
    const def = current._zod.def as { innerType?: z.ZodType }
    current = def.innerType
  }
  return meta
}

export type FlagSpec = {
  key: string
  flag: string
  short?: string
  kind: "boolean" | "string" | "number"
  multiple: boolean
  // A nullable value flag also takes `--no-<flag>`, which sets it to null (clears it).
  nullable: boolean
  // Has no default and may not be left out.
  required: boolean
  choices?: string[]
  defaultValue?: unknown
  description?: string
  placeholder?: string
}

type Def = {
  type: string
  innerType?: z.ZodType
  in?: z.ZodType
  element?: z.ZodType
  entries?: Record<string, string>
  defaultValue?: unknown
}
const defOf = (s: z.ZodType) => s._zod.def as unknown as Def

// Peels optional/default/nullable/pipe wrappers to find what the flag holds.
function unwrap(schema: z.ZodType) {
  let def = defOf(schema)
  let defaultValue: unknown
  let nullable = false
  let optional = false
  while (def.innerType || def.type === "pipe") {
    if (def.type === "default") defaultValue = def.defaultValue
    if (def.type === "nullable") nullable = true
    if (def.type === "optional" || def.type === "default") optional = true
    const next = def.innerType ?? def.in
    if (!next) break
    def = defOf(next)
  }
  return { def, defaultValue, nullable, optional }
}

export function flagSpecs(schema: z.ZodObject | undefined): FlagSpec[] {
  return Object.entries(schema?.shape ?? {}).map(([key, field]) => {
    const outer = unwrap(field as z.ZodType)
    const multiple = outer.def.type === "array" && outer.def.element !== undefined
    const { def } = multiple && outer.def.element ? unwrap(outer.def.element) : outer
    const kind = def.type === "boolean" ? "boolean" : def.type === "number" ? "number" : "string"
    const meta = metaOf(field as z.ZodType)
    return {
      key,
      flag: kebab(key),
      short: meta.short,
      kind,
      multiple,
      nullable: outer.nullable && kind !== "boolean",
      required: !outer.optional,
      choices: def.type === "enum" && def.entries ? Object.values(def.entries) : undefined,
      defaultValue: outer.defaultValue,
      description: meta.description,
      placeholder: meta.placeholder,
    }
  })
}

// A switch that is on by default is only ever typed as its negation (`--no-color`).
export const negationOnly = (s: FlagSpec) => s.kind === "boolean" && s.defaultValue === true

// Every spelling a flag answers to. Booleans and nullable flags also take `--no-<flag>`; a
// global that is on by default answers to that alone.
function spelled(s: FlagSpec, scope: "global" | "command") {
  if (scope === "global" && negationOnly(s)) return [`--no-${s.flag}`]
  const negated = s.kind === "boolean" || s.nullable ? [`--no-${s.flag}`] : []
  return [`--${s.flag}`, ...negated, ...(s.short ? [`-${s.short}`] : [])]
}

export const GLOBAL_SPECS = flagSpecs(globalFlags)

// The global flags help and completion list for a command: -w and -p only where it reads them.
export const inheritedFlags = (cmd?: Command) =>
  GLOBAL_SPECS.filter(
    (s) =>
      s.key !== "version" &&
      ((s.key !== "workspace" && s.key !== "project") || cmd?.context?.includes(s.key)),
  )
