#!/usr/bin/env bun
import { type ResolvedContext, requireHost, resolveContext } from "./client/context"
import { createHttp, type DebugLevel, DryRunDone, type Http } from "./client/http"
import { nouns, resolveWords } from "./commands"
import { readConfig, readHosts } from "./config/config"
import { configDir } from "./config/paths"
import { readToken } from "./config/secrets"
import { CliError, formatError, usageError } from "./output/errors"
import { selectFields, toJson } from "./output/json"
import { detectMode, type Env } from "./output/mode"
import { FIELD_SETS, render } from "./output/render"
import { type Ctx, defineCommand, type Globals } from "./registry/define"
import { commandHelp, groupHelp, rootHelp, topicHelp } from "./registry/help"
import { commandWordIndexes, parseCommand } from "./registry/parse"
import { VERSION } from "./version"

const root = defineCommand({ name: "intesa", summary: "", run() {} })
const stdout = (text: string) => void process.stdout.write(text)
const stderr = (text: string) => void process.stderr.write(text)
const print = (text: string) => {
  stdout(text)
  return 0
}

function debugLevel(env: Env, flag: boolean): DebugLevel {
  if (env.INTESA_DEBUG === "api") return "api"
  if (flag || (env.INTESA_DEBUG && env.INTESA_DEBUG !== "0")) return "requests"
  return "off"
}

function createCtx(globals: Globals, env: Env): Ctx {
  const dir = configDir(env)
  const config = readConfig(dir)
  const mode = detectMode(env, { color: globals.color, configColor: config.color })
  let context: ResolvedContext | undefined
  let http: Promise<Http> | undefined
  const ctx: Ctx = {
    globals,
    env,
    cwd: process.cwd(),
    mode,
    configDir: dir,
    config,
    context: () => {
      context ??= resolveContext({
        flags: globals,
        env,
        cwd: ctx.cwd,
        config,
        hosts: Object.keys(readHosts(dir)),
      })
      return context
    },
    http: () => {
      http ??= (async () => {
        const host = requireHost(ctx.context())
        const credentials = await readToken(dir, host, env)
        return createHttp({
          host,
          token: credentials?.token,
          dryRun: globals.dryRun,
          debug: debugLevel(env, globals.debug),
          stdout,
          stderr,
        })
      })()
      return http
    },
    stdout,
    stderr,
    readStdin: () => Bun.stdin.text(),
  }
  return ctx
}

async function main(argv: string[], env: Env): Promise<number> {
  const flagArgs = argv.slice(0, argv.includes("--") ? argv.indexOf("--") : undefined)
  let json = flagArgs.includes("--json")
  const color = () => detectMode(env, { color: !flagArgs.includes("--no-color") }).color
  try {
    const indexes = commandWordIndexes(argv)
    const words = indexes.map((i) => argv[i] ?? "")
    const wantsHelp = flagArgs.includes("-h") || flagArgs.includes("--help")

    if (words[0] === "help") {
      const [topic] = words.slice(1)
      if (topic === undefined) return print(rootHelp(nouns, color()))
      const text = topicHelp(topic, color())
      if (text) return print(text)
      const found = await resolveWords(words.slice(1)).catch(() => {
        throw usageError(`unknown help topic "${words.slice(1).join(" ")}"`, "Run `intesa help`.")
      })
      if (!found.cmd && found.noun.kind === "group") return print(groupHelp(found.noun, color()))
      if (found.cmd) return print(commandHelp(found.cmd, found.path, color()))
    }

    if (words.length === 0) {
      const { globals } = parseCommand(root, argv)
      json = globals.json
      if (globals.version) {
        stdout(globals.json ? toJson({ version: VERSION }) : `intesa version ${VERSION}\n`)
      } else stdout(rootHelp(nouns, color()))
      return 0
    }

    const found = await resolveWords(words)
    if (!found.cmd) {
      if (found.noun.kind === "group") stdout(groupHelp(found.noun, color()))
      return 0
    }
    const { cmd, path } = found
    if (wantsHelp) return print(commandHelp(cmd, path, color()))

    const used = new Set(indexes.slice(0, found.consumed))
    let parsed: ReturnType<typeof parseCommand>
    try {
      parsed = parseCommand(
        cmd,
        argv.filter((_, i) => !used.has(i)),
      )
    } catch (err) {
      if (!(err instanceof CliError) || err.hint) throw err
      throw usageError(err.message, `Run \`intesa ${path.join(" ")} --help\` for usage.`)
    }
    const { globals, flags, args } = parsed
    json = globals.json
    if (globals.version) return print(`intesa version ${VERSION}\n`)

    const fields = selectFields(
      globals.fields,
      cmd.output ? FIELD_SETS[cmd.output].fields : undefined,
    )
    const ctx = createCtx(globals, env)
    const result = await cmd.run(ctx, args as never, flags)
    if (result !== undefined) {
      stdout(
        render(result, { output: cmd.output, fields, json, quiet: globals.quiet, mode: ctx.mode }),
      )
    }
    return 0
  } catch (err) {
    if (err instanceof DryRunDone) return 0
    const e =
      err instanceof CliError
        ? err
        : new CliError(err instanceof Error ? err.message : String(err), {
            code: "INTERNAL",
            exitCode: 1,
          })
    stderr(formatError(e, json))
    if (!(err instanceof CliError) && env.INTESA_DEBUG && err instanceof Error)
      stderr(`${err.stack}\n`)
    return e.exitCode
  }
}

// Ctrl+C: exit 3 (cancelled), distinct from usage errors.
process.on("SIGINT", () => {
  stderr("\n")
  process.exit(3)
})

process.exitCode = await main(process.argv.slice(2), process.env)
