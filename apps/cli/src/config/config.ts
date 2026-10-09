import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { CliError, usageError } from "../output/errors"

const configSchema = z.looseObject({
  host: z.string().optional().describe("Default server URL"),
  workspace: z.string().optional().describe("Default workspace slug"),
  project: z.string().optional().describe("Default project key"),
  editor: z.string().optional().describe("Editor command; falls back to VISUAL, then EDITOR"),
  pager: z.string().optional().describe("Pager command; falls back to INTESA_PAGER, then PAGER"),
  browser: z.string().optional().describe("Browser command; falls back to BROWSER"),
  prompt: z.enum(["enabled", "disabled"]).optional().describe("Whether to prompt for input"),
  color: z.enum(["auto", "always", "never"]).optional().describe("When to use color"),
})

export type Config = z.infer<typeof configSchema>
export type ConfigKey = keyof typeof configSchema.shape
export const CONFIG_KEYS = Object.keys(configSchema.shape) as ConfigKey[]
export const CONFIG_DEFAULTS: Partial<Record<ConfigKey, string>> = {
  prompt: "enabled",
  color: "auto",
}
const choicesOf = (key: ConfigKey) => {
  const inner = configSchema.shape[key].unwrap()
  return inner instanceof z.ZodEnum ? (inner.options as string[]) : undefined
}

export const configKeyHelp = (key: ConfigKey) => {
  const choices = choicesOf(key)
  return `${configSchema.shape[key].description ?? ""}${choices ? `: {${choices.join("|")}}` : ""}`
}

const hostSchema = z.looseObject({
  user: z.string().optional(),
  tokenId: z.string().optional(),
  kind: z.enum(["cli", "pat"]).optional(),
  scope: z.enum(["read", "write"]).optional(),
  storage: z.enum(["keychain", "file"]).optional(),
  // Only with file storage, i.e. when the OS keychain is unavailable or refused.
  token: z.string().optional(),
  // Slugs are what people type; the id is what the API wants. Cached to save a lookup.
  workspace: z.object({ slug: z.string(), id: z.string() }).optional(),
})
export type HostEntry = z.infer<typeof hostSchema>
const hostsSchema = z.record(z.string(), hostSchema)

function readJson<T>(path: string, schema: z.ZodType<T>, empty: T): T {
  if (!existsSync(path)) return empty
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw new CliError(`${path} is not valid JSON`, { code: "CONFIG_ERROR", exitCode: 1 })
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.join(".") || "file"
    throw new CliError(`${path}: invalid ${where}: ${issue?.message}`, {
      code: "CONFIG_ERROR",
      exitCode: 1,
    })
  }
  return parsed.data
}

function writeJson(dir: string, name: string, value: unknown) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  // hosts.json can hold a token, so both files are private to the user. The mode only
  // applies on creation; chmod covers files that already existed.
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export const readConfig = (dir: string) => readJson(join(dir, "config.json"), configSchema, {})
export const writeConfig = (dir: string, config: Config) => writeJson(dir, "config.json", config)
export const readHosts = (dir: string) => readJson(join(dir, "hosts.json"), hostsSchema, {})
export const writeHosts = (dir: string, hosts: Record<string, HostEntry>) =>
  writeJson(dir, "hosts.json", hosts)

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/

// "pm.example.com" → "https://pm.example.com"; "localhost:3000/" → "http://localhost:3000".
export function normalizeHost(input: string): string {
  const withScheme = /^[a-z]+:\/\//i.test(input)
    ? input
    : `${LOCAL.test(input) ? "http" : "https"}://${input}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error()
    return url.origin
  } catch {
    throw usageError(`invalid host "${input}": expected a URL like https://pm.example.com`)
  }
}

export function parseConfigKey(key: string): ConfigKey {
  if ((CONFIG_KEYS as string[]).includes(key)) return key as ConfigKey
  throw usageError(`unknown config key "${key}" (valid keys: ${CONFIG_KEYS.join(", ")})`)
}

export function parseConfigValue(key: ConfigKey, value: string): string {
  if (key === "host") return normalizeHost(value)
  const choices = choicesOf(key)
  if (choices && !choices.includes(value)) {
    throw usageError(`invalid value "${value}" for ${key}: expected ${choices.join("|")}`)
  }
  return value
}
