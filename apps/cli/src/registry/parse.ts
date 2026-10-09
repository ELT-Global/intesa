import { parseArgs } from "node:util"
import type { z } from "zod"
import { type CliError, usageError } from "../output/errors"
import { type Command, type Globals, globalFlags, kebab, metaOf } from "./define"

export type FlagSpec = {
  key: string
  flag: string
  short?: string
  kind: "boolean" | "string" | "number"
  multiple: boolean
  // A nullable value flag also takes `--no-<flag>`, which sets it to null (clears it).
  nullable: boolean
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
function unwrap(schema: z.ZodType): { def: Def; defaultValue?: unknown; nullable: boolean } {
  let def = defOf(schema)
  let defaultValue: unknown
  let nullable = false
  while (def.innerType || def.type === "pipe") {
    if (def.type === "default") defaultValue = def.defaultValue
    if (def.type === "nullable") nullable = true
    const next = def.innerType ?? def.in
    if (!next) break
    def = defOf(next)
  }
  return { def, defaultValue, nullable }
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
      choices: def.type === "enum" && def.entries ? Object.values(def.entries) : undefined,
      defaultValue: outer.defaultValue,
      description: meta.description,
      placeholder: meta.placeholder,
    }
  })
}

const GLOBAL_SPECS = flagSpecs(globalFlags)

// Indexes of the leading command words (`task`, `list`), skipping global flags and their
// values so `intesa -w acme task list` works. Stops at `--`.
export function commandWordIndexes(argv: string[]): number[] {
  const takesValue = new Set(
    GLOBAL_SPECS.filter((s) => s.kind !== "boolean").flatMap((s) => [
      `--${s.flag}`,
      ...(s.short ? [`-${s.short}`] : []),
    ]),
  )
  const found: number[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg === "--") break
    if (arg.startsWith("-") && arg.length > 1) {
      if (takesValue.has(arg)) i++
      continue
    }
    found.push(i)
  }
  return found
}

function translate(err: unknown): CliError {
  const e = err as { code?: string; message?: string }
  const message = e.message ?? String(err)
  if (e.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    return usageError(`unknown flag: ${/'([^']+)'/.exec(message)?.[1] ?? message}`)
  }
  if (e.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
    const flag = /--[\w-]+/.exec(message)?.[0] ?? message
    if (message.includes("does not take")) return usageError(`flag does not take a value: ${flag}`)
    return usageError(`flag needs a value: ${flag} (write ${flag}=-x for values starting with "-")`)
  }
  return usageError(message)
}

function coerce(spec: FlagSpec, raw: string | boolean) {
  if (typeof raw === "boolean") return raw
  if (spec.choices && !spec.choices.includes(raw)) {
    throw usageError(
      `invalid value "${raw}" for --${spec.flag}: expected ${spec.choices.join("|")}`,
    )
  }
  if (spec.kind !== "number") return raw
  const n = Number(raw)
  if (raw.trim() === "" || Number.isNaN(n)) {
    throw usageError(`invalid value "${raw}" for --${spec.flag}: expected a number`)
  }
  return n
}

function validate<T>(schema: z.ZodObject, specs: FlagSpec[], raw: Record<string, unknown>): T {
  const result = schema.safeParse(raw)
  if (result.success) return result.data as T
  const issue = result.error.issues[0]
  const spec = specs.find((s) => s.key === issue?.path[0])
  throw usageError(`invalid value for --${spec?.flag ?? issue?.path.join(".")}: ${issue?.message}`)
}

export function parseCommand(cmd: Command, argv: string[]) {
  const ownSpecs = flagSpecs(cmd.flags)
  const options: Record<string, { type: "boolean" | "string"; multiple: boolean; short?: string }> =
    {}
  for (const s of [...GLOBAL_SPECS, ...ownSpecs]) {
    options[s.flag] = {
      type: s.kind === "boolean" ? "boolean" : "string",
      multiple: s.multiple,
      ...(s.short ? { short: s.short } : {}),
    }
  }
  // `--no-x` for a nullable value flag is taken out before parseArgs, which only negates
  // booleans. Arguments after `--` are left alone.
  const negatable = new Map(ownSpecs.filter((s) => s.nullable).map((s) => [`--no-${s.flag}`, s]))
  const end = argv.indexOf("--")
  const cleared = new Set<FlagSpec>()
  const rest = argv.filter((arg, i) => {
    const spec = (end === -1 || i < end) && negatable.get(arg)
    if (spec) cleared.add(spec)
    return !spec
  })
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: rest,
      options,
      strict: true,
      allowPositionals: true,
      allowNegative: true,
    })
  } catch (err) {
    throw translate(err)
  }

  const collect = (specs: FlagSpec[]) => {
    const raw: Record<string, unknown> = {}
    for (const s of specs) {
      const v = parsed.values[s.flag] as string | boolean | (string | boolean)[] | undefined
      if (v !== undefined) raw[s.key] = Array.isArray(v) ? v.map((x) => coerce(s, x)) : coerce(s, v)
    }
    return raw
  }
  const globals = validate<Globals>(globalFlags, GLOBAL_SPECS, collect(GLOBAL_SPECS))
  const own = collect(ownSpecs)
  for (const s of cleared) {
    if (own[s.key] !== undefined) throw usageError(`--${s.flag} and --no-${s.flag} conflict`)
    own[s.key] = null
  }
  const flags = cmd.flags ? validate<Record<string, unknown>>(cmd.flags, ownSpecs, own) : {}

  const positionals = parsed.positionals
  const args: Record<string, string | string[] | undefined> = {}
  let i = 0
  for (const a of cmd.args ?? []) {
    if (a.variadic) {
      args[a.name] = positionals.slice(i)
      i = positionals.length
      if (a.required && args[a.name]?.length === 0) throw usageError(`missing argument <${a.name}>`)
      continue
    }
    const value = positionals[i++]
    if (value === undefined && a.required) throw usageError(`missing argument <${a.name}>`)
    if (value !== undefined && a.enum && !a.enum.includes(value)) {
      throw usageError(`invalid value "${value}" for <${a.name}>: expected ${a.enum.join("|")}`)
    }
    args[a.name] = value
  }
  if (i < positionals.length) throw usageError(`unexpected argument "${positionals[i]}"`)

  return { globals, flags, args }
}
