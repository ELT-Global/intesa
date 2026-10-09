import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createTestApp, signIn } from "../../api/test/helpers"
import { saveToken } from "../src/config/secrets"

const MAIN = resolve(import.meta.dir, "../src/main.ts")

export type RunResult = {
  stdout: string
  // The same output as raw bytes, for commands that print files.
  stdoutBytes: Uint8Array
  stderr: string
  exitCode: number
  // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary output shapes
  json: () => any
}

export type RunOptions = {
  // Merged over the sandbox env; `undefined` removes a variable.
  env?: Record<string, string | undefined>
  cwd?: string
  stdin?: string
}

// Variables from the developer's shell that would change what the CLI does.
const LEAKY = /^(INTESA_|NO_COLOR$|CLICOLOR|CI$|VISUAL$|EDITOR$|PAGER$|BROWSER$)/

export type Sandbox = {
  // A temp directory the CLI runs in by default; nothing above it has a `.intesa.json`.
  root: string
  configDir: string
  run: (args: string[], opts?: RunOptions) => Promise<RunResult>
  // Starts the CLI without waiting, for tests that act while it runs (device sign-in).
  start: (args: string[], opts?: RunOptions) => Started
}

export type Started = {
  exited: Promise<number>
  stdout: () => string
  stderr: () => string
  // Resolves with the first match in stderr so far, waiting for more output up to ~10 s.
  waitForStderr: (pattern: RegExp) => Promise<RegExpExecArray>
}

function collect(stream: ReadableStream<Uint8Array>) {
  let text = ""
  const decoder = new TextDecoder()
  const done = (async () => {
    for await (const chunk of stream) text += decoder.decode(chunk, { stream: true })
  })()
  return { text: () => text, done }
}

// A throwaway config dir and cwd. Credentials always go to a file (INTESA_SECRETS=file), so
// tests never touch the OS keychain, and prompts are off because there is no TTY.
export function sandbox(host?: string): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "intesa-cli-"))
  sandboxes.push(root)
  const configDir = join(root, "config")
  const cwd = join(root, "work")
  mkdirSync(cwd, { recursive: true })

  const spawn = (args: string[], opts: RunOptions = {}) => {
    const env: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(process.env)) if (!LEAKY.test(k)) env[k] = v
    Object.assign(env, {
      INTESA_CONFIG_DIR: configDir,
      INTESA_SECRETS: "file",
      INTESA_PROMPT_DISABLED: "1",
      INTESA_HOST: host,
      ...opts.env,
    })
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]

    return Bun.spawn([process.execPath, MAIN, ...args], {
      cwd: opts.cwd ?? cwd,
      env,
      stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
      stdout: "pipe",
      stderr: "pipe",
    })
  }

  const run = async (args: string[], opts: RunOptions = {}): Promise<RunResult> => {
    const proc = spawn(args, opts)
    const [stdoutBytes, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer().then((b) => new Uint8Array(b)),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const stdout = new TextDecoder().decode(stdoutBytes)
    return { stdout, stdoutBytes, stderr, exitCode, json: () => JSON.parse(stdout) }
  }

  const start = (args: string[], opts: RunOptions = {}): Started => {
    const proc = spawn(args, opts)
    const out = collect(proc.stdout)
    const err = collect(proc.stderr)
    return {
      exited: Promise.all([proc.exited, out.done, err.done]).then(([code]) => code),
      stdout: out.text,
      stderr: err.text,
      async waitForStderr(pattern) {
        for (let i = 0; i < 400; i++) {
          const match = pattern.exec(err.text())
          if (match) return match
          await Bun.sleep(25)
        }
        throw new Error(`stderr never matched ${pattern}:\n${err.text()}`)
      },
    }
  }
  return { root, configDir, run, start }
}

const sandboxes: string[] = []

export function removeSandboxes() {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
}

// The real API on in-memory SQLite, listening on a random local port.
export async function startServer() {
  const t = await createTestApp()
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: t.app.fetch })
  return { ...t, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}

export type TestServer = Awaited<ReturnType<typeof startServer>>

// A minimal stand-in server for tests that only care which host was called, or how often.
export function fakeServer(handler: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}

// Signs `email` in through dev-login, mints an API token with that session and stores it
// for `server` in the sandbox (file storage), as `intesa auth login` would.
export async function loginAs(
  box: Sandbox,
  server: TestServer,
  email: string,
  opts: { scope?: "read" | "write" } = {},
) {
  const session = await signIn(server.app, email)
  const res = await session.call("POST", "/api/me/tokens", { name: "cli test", ...opts })
  if (res.status !== 201) throw new Error(`token creation failed: ${res.status}`)
  const { token, id, kind, scope } = res.body as {
    token: string
    id: string
    kind: "cli" | "pat"
    scope: "read" | "write"
  }
  await saveToken(
    box.configDir,
    server.url,
    token,
    { user: email, tokenId: id, kind, scope },
    {
      env: { INTESA_SECRETS: "file" },
    },
  )
  return { token, tokenId: id, session }
}
