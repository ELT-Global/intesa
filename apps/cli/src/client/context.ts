import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { type Config, configFile, normalizeHost, readConfig, writeJsonFile } from "../config/config"
import { CliError, LOGIN_HINT, notLoggedIn } from "../output/errors"
import type { Env } from "../output/mode"
import type { Ctx } from "../registry/define"
import { dryRunWrite } from "./http"

export type Resolved = { value: string }
export type ResolvedContext = { host?: Resolved; workspace?: Resolved; project?: Resolved }

const LOCAL_FILE = ".intesa.json"
const localSchema = z.looseObject({
  host: z.string().optional(),
  workspace: z.string().optional(),
  project: z.string().optional(),
})

// The nearest `.intesa.json` from cwd upwards, like `.git`: a repo can pin its board.
export function findLocalFile(cwd: string) {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const path = join(dir, LOCAL_FILE)
    if (existsSync(path)) {
      let data: unknown
      try {
        data = JSON.parse(readFileSync(path, "utf8"))
      } catch {
        data = undefined
      }
      const parsed = localSchema.safeParse(data)
      if (!parsed.success) {
        throw new CliError(`${path} must be a JSON object like {"workspace": "acme"}`, {
          code: "CONFIG_ERROR",
          exitCode: 1,
        })
      }
      return { path, data: parsed.data }
    }
    if (dirname(dir) === dir) return undefined
  }
}

// `use`: makes a workspace or project the default in the user config, or with `local` in
// `.intesa.json` in cwd itself (not a parent's), keeping the keys already there. --dry-run
// shows the write instead. Returns the file written.
export function saveDefault(
  ctx: Pick<Ctx, "cwd" | "configDir" | "globals" | "stdout">,
  key: "workspace" | "project",
  value: string,
  local: boolean,
): string {
  const path = local ? join(ctx.cwd, LOCAL_FILE) : configFile(ctx.configDir)
  const current = local
    ? existsSync(path)
      ? (findLocalFile(ctx.cwd)?.data ?? {})
      : {}
    : readConfig(ctx.configDir)
  const data = { ...current, [key]: value }
  if (ctx.globals.dryRun) dryRunWrite(ctx, path, data)
  writeJsonFile(path, data, local ? undefined : 0o600)
  return path
}

type Input = {
  flags: { host?: string; workspace?: string; project?: string }
  env: Env
  cwd: string
  config: Config
  // Hosts with stored credentials; a single one is the last-resort default.
  hosts: string[]
}

// Precedence per value: flag > env > nearest .intesa.json > config default.
export function resolveContext({ flags, env, cwd, config, hosts }: Input): ResolvedContext {
  const local = findLocalFile(cwd)
  const pick = (key: "host" | "workspace" | "project", envName: string): Resolved | undefined => {
    const value = flags[key] || env[envName] || local?.data[key] || config[key]
    return value ? { value } : undefined
  }
  let host = pick("host", "INTESA_HOST")
  if (!host && hosts.length === 1 && hosts[0]) host = { value: hosts[0] }
  return {
    host: host && { value: normalizeHost(host.value) },
    workspace: pick("workspace", "INTESA_WORKSPACE"),
    project: pick("project", "INTESA_PROJECT"),
  }
}

export function requireHost(ctx: ResolvedContext): string {
  if (ctx.host) return ctx.host.value
  throw notLoggedIn(
    "no Intesa server configured",
    `${LOGIN_HINT} Or pass --host, or set INTESA_HOST.`,
  )
}
