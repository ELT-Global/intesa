#!/usr/bin/env bun
import { type ResolvedContext, requireHost, resolveContext } from "./client/context"
import { createHttp, DryRunDone, debugLevel, type Http, timeoutMs } from "./client/http"
import { nouns, resolveWords } from "./commands"
import { readConfig, readHosts } from "./config/config"
import { configDir } from "./config/paths"
import { readToken } from "./config/secrets"
import { editing } from "./io/editor"
import { page, paging } from "./io/pager"
import { CliError, formatError, usageError } from "./output/errors"
import { selectFields, toJson } from "./output/json"
import { detectMode, type Env } from "./output/mode"
import { FIELD_SETS, render } from "./output/render"
import { complete } from "./registry/completion"
import {
  type Command,
  type Ctx,
  defineCommand,
  type Globals,
  globalFlags,
  type Io,
} from "./registry/define"
import { commandHelp, groupHelp, rootHelp, topicHelp } from "./registry/help"
import { commandWordIndexes, parseCommand } from "./registry/parse"
import { VERSION } from "./version"

const root = defineCommand({ name: "intesa", summary: "", run() {} })
const processIo: Io = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  readStdin: () => Bun.stdin.text(),
}

// `quick` is for completion: a short timeout and no retries, since someone is waiting at tab.
function createCtx(globals: Globals, env: Env, io: Io, opts: { quick?: boolean } = {}): Ctx {
  const { stdout, stderr } = io
  const dir = configDir(env)
  const config = readConfig(dir)
  const mode = detectMode(env, { color: globals.color, configColor: config.color })
  let context: ResolvedContext | undefined
  const clients: { loud?: Promise<Http>; quiet?: Promise<Http> } = {}
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
    http: (httpOpts) => {
      const key = httpOpts?.quiet ? "quiet" : "loud"
      clients[key] ??= (async () => {
        const host = requireHost(ctx.context())
        const credentials = await readToken(dir, host, env)
        return createHttp({
          host,
          token: credentials?.token,
          dryRun: globals.dryRun,
          debug: httpOpts?.quiet ? "off" : debugLevel(env, globals.debug),
          stdout,
          stderr,
          timeoutMs: opts.quick ? Math.min(timeoutMs(env), 2000) : timeoutMs(env),
          retry: !opts.quick,
        })
      })()
      return clients[key] as Promise<Http>
    },
    stdout,
    stderr,
    done: (message) => {
      if (!globals.quiet) stderr(`✓ ${message}\n`)
    },
    readStdin: io.readStdin,
    invoke: main,
  }
  return ctx
}

// --json, -q and --fields print the data as such; otherwise the command's own format, if it
// has one, else a table.
async function present(ctx: Ctx, cmd: Command, data: unknown, flags: unknown) {
  const { json, quiet } = ctx.globals
  const fields = selectFields(ctx.globals.fields, cmd.output && FIELD_SETS[cmd.output].fields)
  if (cmd.human && !json && !quiet && !fields) return cmd.human(ctx, data as never, flags as never)
  return render(data, { output: cmd.output, fields, json, quiet, mode: ctx.mode })
}

async function main(argv: string[], env: Env, io: Io = processIo): Promise<number> {
  const { stdout, stderr } = io
  const print = (text: string) => {
    stdout(text)
    return 0
  }
  // Called by the completion scripts on every tab press: quiet, quick and never failing.
  if (argv[0] === "__complete") {
    try {
      stdout(
        await complete(argv.slice(1), (typed) =>
          createCtx(globalFlags.parse(typed), env, io, { quick: true }),
        ),
      )
    } catch {}
    return 0
  }

  const flagArgs = argv.slice(0, argv.includes("--") ? argv.indexOf("--") : undefined)
  let json = flagArgs.includes("--json")
  const color = () => detectMode(env, { color: !flagArgs.includes("--no-color") }).color
  let show: ((data: unknown) => Promise<void>) | undefined
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
      if ((!found.cmd || found.viaDefault) && found.noun.kind === "group") {
        return print(groupHelp(found.noun, color()))
      }
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
    if (wantsHelp) {
      if (found.viaDefault && found.noun.kind === "group")
        return print(groupHelp(found.noun, color()))
      return print(commandHelp(cmd, path, color()))
    }

    const usage = `Run \`intesa ${path.join(" ")} --help\` for usage.`
    const used = new Set(indexes.slice(0, found.consumed))
    let parsed: ReturnType<typeof parseCommand>
    try {
      parsed = parseCommand(
        cmd,
        argv.filter((_, i) => !used.has(i)),
      )
    } catch (err) {
      if (!(err instanceof CliError) || err.hint) throw err
      throw usageError(err.message, usage)
    }
    const { globals, flags, args } = parsed
    json = globals.json
    if (globals.version) return print(`intesa version ${VERSION}\n`)
    if (globals.fields !== undefined && !cmd.output) {
      throw usageError(`--fields does not apply to \`intesa ${path.join(" ")}\``, usage)
    }
    // Checked before anything runs, so a typo never follows a write.
    selectFields(globals.fields, cmd.output && FIELD_SETS[cmd.output].fields)

    const ctx = createCtx(globals, env, io)
    show = async (data) => {
      if (data === undefined) return
      const text = await present(ctx, cmd, data, flags)
      // Only a view's human format goes through the pager: not data, and not output that
      // `intesa mcp` captures.
      const human = !globals.json && !globals.quiet && globals.fields === undefined
      if (!(cmd.paged && human && io === processIo && (await page(ctx, text)))) stdout(text)
    }
    await show(await cmd.run(ctx, args as never, flags))
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
    if (e.result !== undefined) await show?.(e.result).catch(() => {})
    stderr(formatError(e, json))
    const debug = debugLevel(env, flagArgs.includes("--debug")) !== "off"
    if (!(err instanceof CliError) && debug && err instanceof Error) stderr(`${err.stack}\n`)
    return e.exitCode
  }
}

// Ctrl+C: exit 3 (cancelled). The exit waits a turn so later SIGINT listeners (OpenTUI's,
// which restores the terminal) still run; while an editor has the terminal, Ctrl+C is the
// editor's (or pager's), as in git, and editText cleans up when it returns.
process.on("SIGINT", () => {
  if (editing() || paging()) return
  processIo.stderr("\n")
  process.exitCode = 3
  setImmediate(() => process.exit(3))
})

// The reader of a pipe quit early (`intesa schema | head`): stop quietly with success, like gh.
// What was asked for was delivered as far as anyone wanted it, and a failing exit would fail
// pipelines under `set -o pipefail`.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0)
  throw err
})

process.exitCode = await main(process.argv.slice(2), process.env)
