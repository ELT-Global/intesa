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
  readStdin: () => Promise<string>
}

type AnyFlags = z.ZodObject

export type Command<A extends readonly Arg[] = readonly Arg[], F extends AnyFlags = AnyFlags> = {
  kind: "command"
  name: string
  aliases?: string[]
  summary: string
  description?: string
  args?: A
  flags?: F
  // Which of -w / -p the command reads; only those are listed in its help.
  context?: readonly ("workspace" | "project")[]
  // Field set for --fields, table columns and `intesa schema`.
  output?: OutputName
  examples?: string[]
  // A returned value is printed according to --json / --fields / -q / the output field set.
  run: (ctx: Ctx, args: ArgValues<A>, flags: z.output<F>) => unknown
}

export type Group = {
  kind: "group"
  name: string
  aliases?: string[]
  summary: string
  description?: string
  commands: Command[]
  examples?: string[]
}

export type Noun = Command | Group

export function defineCommand<
  const A extends readonly Arg[] = [],
  F extends AnyFlags = z.ZodObject<Record<never, never>>,
>(def: Omit<Command<A, F>, "kind">): Command {
  // A command flag shadowing a global one would silently change what the global means.
  const taken = new Set(flagNames(globalFlags))
  const clash = flagNames(def.flags).find((n) => taken.has(n))
  if (clash) throw new Error(`${def.name}: flag ${clash} is already a global flag`)
  return { kind: "command", ...def } as unknown as Command
}

const flagNames = (flags: AnyFlags | undefined) =>
  Object.entries(flags?.shape ?? {}).flatMap(([key, schema]) => {
    const short = metaOf(schema as z.ZodType).short
    return [`--${kebab(key)}`, ...(short ? [`-${short}`] : [])]
  })

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
