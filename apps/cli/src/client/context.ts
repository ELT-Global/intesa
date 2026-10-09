import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { type Config, normalizeHost } from "../config/config"
import { CliError, LOGIN_HINT, usageError } from "../output/errors"
import type { Env } from "../output/mode"

export type Source = "flag" | "env" | "file" | "config" | "hosts"
export type Resolved = { value: string; source: Source; file?: string }
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
    if (flags[key]) return { value: flags[key], source: "flag" }
    if (env[envName]) return { value: env[envName], source: "env" }
    if (local?.data[key]) return { value: local.data[key], source: "file", file: local.path }
    if (config[key]) return { value: config[key], source: "config" }
    return undefined
  }
  let host = pick("host", "INTESA_HOST")
  if (!host && hosts.length === 1 && hosts[0]) host = { value: hosts[0], source: "hosts" }
  if (host) host = { ...host, value: normalizeHost(host.value) }
  return {
    host,
    workspace: pick("workspace", "INTESA_WORKSPACE"),
    project: pick("project", "INTESA_PROJECT"),
  }
}

export function requireHost(ctx: ResolvedContext): string {
  if (ctx.host) return ctx.host.value
  throw new CliError("no Intesa server configured", {
    code: "UNAUTHORIZED",
    exitCode: 4,
    hint: `${LOGIN_HINT} Or pass --host, or set INTESA_HOST.`,
  })
}

export function requireWorkspace(ctx: ResolvedContext): string {
  if (ctx.workspace) return ctx.workspace.value
  throw usageError(
    "no workspace: pass -w/--workspace, set INTESA_WORKSPACE, or add one to .intesa.json",
    "Run `intesa config set workspace SLUG` to set a default.",
  )
}

export function requireProject(ctx: ResolvedContext): string {
  if (ctx.project) return ctx.project.value
  throw usageError(
    "no project: pass -p/--project, set INTESA_PROJECT, or add one to .intesa.json",
    "Run `intesa config set project KEY` to set a default.",
  )
}
