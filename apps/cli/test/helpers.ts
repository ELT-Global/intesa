import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { addMember, createTestApp, signIn, userId } from "../../api/test/helpers"
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
  // Options for bun itself, before the script (e.g. --preload).
  bunArgs?: string[]
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

    return Bun.spawn([process.execPath, ...(opts.bunArgs ?? []), MAIN, ...args], {
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

let n = 0

// A sandbox signed in as a new user, "Alan Owner", with a token of `scope`. `id` is unique
// per call, for slugs and emails.
export async function signedIn(server: TestServer, opts: { scope?: "read" | "write" } = {}) {
  const id = `u${++n}-${crypto.randomUUID().slice(0, 6)}`
  const box = sandbox(server.url)
  const email = `${id}@example.com`
  const login = await loginAs(box, server, email, opts)
  await login.session.call("PATCH", "/api/me", { name: "Alan Owner" })
  return { id, box, email, me: await userId(server, email), ...login }
}

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary response shapes
type Json = any

// A signed-in user who owns one workspace ("Acme", their only one, so no -w is needed) with a
// project WEB ("Web"), plus shortcuts that seed data straight through the API.
export async function world(server: TestServer, opts: { scope?: "read" | "write" } = {}) {
  const user = await signedIn(server, opts)
  const { id, session } = user
  const workspace = (await session.call("POST", "/api/workspaces", { name: "Acme", slug: id })).body
    .workspace as { id: string; slug: string }

  const addProject = async (name: string, key: string) =>
    (await session.call("POST", `/api/workspaces/${workspace.id}/projects`, { name, key })).body
      .project as { id: string; key: string; name: string }
  const project = await addProject("Web", "WEB")

  const addTask = async (body: Record<string, unknown>, projectId = project.id): Promise<Json> => {
    const res = await session.call("POST", `/api/projects/${projectId}/tasks`, body)
    if (res.status !== 201) throw new Error(`task creation failed: ${JSON.stringify(res.body)}`)
    return res.body.task
  }
  const getTask = async (taskId: string): Promise<Json> =>
    (await session.call("GET", `/api/tasks/${taskId}`)).body?.task
  const patchTask = async (taskId: string, body: Record<string, unknown>) =>
    session.call("PATCH", `/api/tasks/${taskId}`, body)
  const addTag = async (name: string, color?: string) =>
    (await session.call("POST", `/api/workspaces/${workspace.id}/tags`, { name, color })).body
      .tag as { id: string; name: string; color: string }
  const tags = async () =>
    (await session.call("GET", `/api/workspaces/${workspace.id}/tags`)).body.tags as {
      id: string
      name: string
    }[]
  const addField = async (body: Record<string, unknown>, projectId = project.id) =>
    (await session.call("POST", `/api/projects/${projectId}/custom-fields`, body)).body.field as {
      id: string
      name: string
      // biome-ignore lint/suspicious/noExplicitAny: as the API returns it
      [key: string]: any
    }
  // Another person in the workspace.
  const addPerson = async (name: string) => {
    const personEmail = `${name.split(" ")[0]?.toLowerCase()}-${id}@example.com`
    await signIn(server.app, personEmail, name)
    const personId = await addMember(server, workspace.id, personEmail)
    return { id: personId, name, email: personEmail }
  }
  const projectTasks = async (projectId = project.id): Promise<Json[]> =>
    (await session.call("GET", `/api/projects/${projectId}/tasks`)).body.tasks

  return {
    ...user,
    workspace,
    project,
    addProject,
    addTask,
    getTask,
    patchTask,
    addTag,
    tags,
    addField,
    addPerson,
    projectTasks,
  }
}

export type World = Awaited<ReturnType<typeof world>>

export const keysOf = (rows: { key: string }[]) => rows.map((r) => r.key)
export const lines = (text: string) => text.split("\n").filter(Boolean)
