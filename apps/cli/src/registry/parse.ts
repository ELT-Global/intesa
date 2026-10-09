import { parseArgs } from "node:util"
import type { z } from "zod"
import { type CliError, usageError } from "../output/errors"
import {
  type Command,
  type FlagSpec,
  flagSpecs,
  GLOBAL_SPECS,
  type Globals,
  globalFlags,
  negationOnly,
} from "./define"

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
  if (spec && raw[spec.key] === undefined) {
    throw usageError(
      `missing --${spec.flag}${spec.choices ? ` (one of ${spec.choices.join("|")})` : ""}`,
    )
  }
  throw usageError(`invalid value for --${spec?.flag ?? issue?.path.join(".")}: ${issue?.message}`)
}

export function parseCommand(cmd: Command, argv: string[]) {
  const ownSpecs = flagSpecs(cmd.flags)
  const options: Record<string, { type: "boolean" | "string"; multiple: boolean; short?: string }> =
    {}
  for (const s of [...GLOBAL_SPECS.filter((s) => !negationOnly(s)), ...ownSpecs]) {
    options[s.flag] = {
      type: s.kind === "boolean" ? "boolean" : "string",
      multiple: s.multiple,
      ...(s.short ? { short: s.short } : {}),
    }
  }
  // parseArgs only negates the booleans it knows, so these are taken out first: `--no-color`
  // (a global that only exists negated) and `--no-x` for a nullable value flag, which clears
  // it. Arguments after `--` are left alone.
  const negated = new Map(
    [...GLOBAL_SPECS.filter(negationOnly), ...ownSpecs.filter((s) => s.nullable)].map((s) => [
      `--no-${s.flag}`,
      s,
    ]),
  )
  const end = argv.indexOf("--")
  const cleared = new Set<FlagSpec>()
  const rest = argv.filter((arg, i) => {
    const spec = (end === -1 || i < end) && negated.get(arg)
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
      // A global that only exists negated never takes a parsed value: that name is the
      // command's (`tag create --color`).
      const own = !(specs === GLOBAL_SPECS && negationOnly(s))
      const v = (own ? parsed.values[s.flag] : undefined) as
        | string
        | boolean
        | (string | boolean)[]
        | undefined
      if (v !== undefined) raw[s.key] = Array.isArray(v) ? v.map((x) => coerce(s, x)) : coerce(s, v)
      if (cleared.has(s)) {
        if (v !== undefined) throw usageError(`--${s.flag} and --no-${s.flag} conflict`)
        raw[s.key] = s.kind === "boolean" ? false : null
      }
    }
    return raw
  }
  const globals = validate<Globals>(globalFlags, GLOBAL_SPECS, collect(GLOBAL_SPECS))
  const flags = cmd.flags
    ? validate<Record<string, unknown>>(cmd.flags, ownSpecs, collect(ownSpecs))
    : {}

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
