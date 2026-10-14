import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTestRenderer } from "@opentui/core/testing"
import { addMember, signIn } from "../../api/test/helpers"
import { createHttp } from "../src/client/http"
import { type Ctx, globalFlags } from "../src/registry/define"
import { connect } from "../src/tui/api"
import { createBoardApp } from "../src/tui/app"
import type { Store } from "../src/tui/store"
import type { TestServer } from "./helpers"

let n = 0
const dirs: string[] = []

export function removeBoardDirs() {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary response shapes
type Json = any

/** Polls `check` until it holds; throws after `ms`. */
export async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
  const deadline = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`never happened: ${check}`)
    await Bun.sleep(5)
  }
}

/** Waits until the board has no request in flight or queued; throws if it never gets there. */
export async function idle(store: Store, ms = 5000) {
  const deadline = Date.now() + ms
  for (let pending = store.pending(); pending.length > 0; pending = store.pending()) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), Math.max(0, deadline - Date.now()))
    })
    const settled = Promise.allSettled(pending).then(() => false)
    const timedOut = await Promise.race([settled, late]).finally(() => clearTimeout(timer))
    if (timedOut) throw new Error(`the board was still waiting on requests after ${ms} ms`)
  }
}

/**
 * A signed-in user ("Alan Owner") who owns a workspace with a WEB project, plus the context
 * the board would get from the CLI. Requests go to the real server; `faults.failWrites` makes
 * every write fail with a 500, as a broken server would, and `hold` keeps an answer back.
 */
export async function boardWorld(server: TestServer, opts: { editor?: string } = {}) {
  const slug = `acme${++n}`
  const email = `${slug}@example.com`
  const session = await signIn(server.app, email, "Alan Owner")
  await session.call("PATCH", "/api/me", { name: "Alan Owner" })
  const addWorkspace = async (wsSlug: string) =>
    (await session.call("POST", "/api/workspaces", { name: "Acme", slug: wsSlug })).body
      .workspace as { id: string; slug: string }
  const workspace = await addWorkspace(slug)
  const addProject = async (name: string, key: string, workspaceId = workspace.id) =>
    (await session.call("POST", `/api/workspaces/${workspaceId}/projects`, { name, key })).body
      .project as { id: string; key: string }
  const project = await addProject("Web", "WEB")
  const token = (await session.call("POST", "/api/me/tokens", { name: "board test" })).body
    .token as string
  const me = (await session.call("GET", "/api/me")).body.user.id as string

  const faults = { failWrites: false }
  // Answers held back until released, and every request answered, as "METHOD /path".
  const holds: { method: string; path: string; arrived: () => void; gate: Promise<void> }[] = []
  const answered: string[] = []
  const http = createHttp({
    host: server.url,
    token,
    dryRun: false,
    debug: "off",
    stdout: () => {},
    stderr: () => {},
    fetch: (async (req: Request) => {
      const path = new URL(req.url).pathname
      if (faults.failWrites && req.method !== "GET") {
        return Response.json({ code: "INTERNAL", message: "boom" }, { status: 500 })
      }
      const res = await fetch(req)
      const at = holds.findIndex((h) => h.method === req.method && h.path === path)
      const hold = at >= 0 ? holds.splice(at, 1)[0] : undefined
      if (hold) {
        hold.arrived()
        await hold.gate
      }
      answered.push(`${req.method} ${path}`)
      return res
    }) as typeof fetch,
  })
  const dir = mkdtempSync(join(tmpdir(), "intesa-board-"))
  dirs.push(dir)
  // The "browser" writes down the URLs it is asked to open.
  const browserLog = join(dir, "opened.txt")
  const browserScript = join(dir, "browser.js")
  await Bun.write(
    browserScript,
    `require("node:fs").appendFileSync(${JSON.stringify(browserLog)}, process.argv[2] + "\\n")`,
  )
  const ctx = {
    globals: globalFlags.parse({}),
    env: {},
    cwd: dir,
    mode: { tty: true, color: false, width: 120 },
    configDir: dir,
    config: {
      // Never the platform editor: a test that edits by mistake fails instead of waiting.
      editor: opts.editor ?? `"${process.execPath}" -e process.exit(1)`,
      browser: `"${process.execPath}" "${browserScript}"`,
    },
    context: () => ({
      host: { value: server.url, source: "flag" },
      workspace: { value: slug, source: "flag" },
      project: { value: "WEB", source: "flag" },
    }),
    http: async () => http,
    stdout: () => {},
    stderr: () => {},
    readStdin: async () => "",
  } as unknown as Ctx

  const addTask = async (body: Record<string, unknown>, projectId = project.id): Promise<Json> => {
    const res = await session.call("POST", `/api/projects/${projectId}/tasks`, body)
    if (res.status !== 201) throw new Error(`task creation failed: ${JSON.stringify(res.body)}`)
    return res.body.task
  }
  const getTask = async (id: string): Promise<Json> =>
    (await session.call("GET", `/api/tasks/${id}`)).body?.task
  const patchTask = (id: string, body: Record<string, unknown>) =>
    session.call("PATCH", `/api/tasks/${id}`, body)
  const deleteTask = (id: string) => session.call("DELETE", `/api/tasks/${id}`)
  const projectTasks = async (): Promise<Json[]> =>
    (await session.call("GET", `/api/projects/${project.id}/tasks`)).body.tasks
  // Keys of a column, top to bottom, as the server orders it.
  const column = async (status: string) =>
    (await projectTasks()).filter((t) => t.status === status).map((t) => t.key as string)
  const addPerson = async (name: string) => {
    const personEmail = `${name.split(" ")[0]?.toLowerCase()}-${slug}@example.com`
    await signIn(server.app, personEmail, name)
    return { id: await addMember(server, workspace.id, personEmail), name }
  }
  const artifactPath = (taskId: string, id = "") =>
    `/api/tasks/${taskId}/artifacts${id ? `/${id}` : ""}`
  const addArtifact = async (taskId: string, name: string, content: string) => {
    const form = new FormData()
    form.append("file", new File([content], name))
    const res = await session.request(artifactPath(taskId), { method: "POST", body: form })
    return ((await res.json()) as { artifact: { id: string } }).artifact
  }
  const artifactText = async (taskId: string, id: string) =>
    (await session.request(artifactPath(taskId, id))).text()
  const artifacts = async (taskId: string): Promise<Json[]> =>
    (await session.call("GET", artifactPath(taskId))).body.artifacts

  return {
    ctx,
    faults,
    answered,
    /**
     * Holds back the server's answer to the next `method path` (sent and answered by the
     * server, not yet given to the board) until `release()`.
     */
    hold(method: string, path: string) {
      let arrived = () => {}
      let release = () => {}
      const reached = new Promise<void>((resolve) => {
        arrived = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      holds.push({ method, path, arrived, gate })
      return { reached, release }
    },
    // URLs the board asked the browser to open.
    opened: () => {
      try {
        return readFileSync(browserLog, "utf8").split("\n").filter(Boolean)
      } catch {
        return []
      }
    },
    me,
    workspace,
    project,
    addWorkspace,
    addProject,
    addTask,
    getTask,
    patchTask,
    deleteTask,
    projectTasks,
    column,
    addPerson,
    addArtifact,
    artifactText,
    artifacts,
  }
}

export type BoardWorld = Awaited<ReturnType<typeof boardWorld>>

/** The board on OpenTUI's test renderer, with helpers to press keys and read frames. */
export async function openBoard(
  world: BoardWorld,
  opts: {
    ref?: string
    width?: number
    height?: number
    pollMs?: number
    saveWaitMs?: number
    color?: boolean
  } = {},
) {
  const t = await createTestRenderer({
    width: opts.width ?? 120,
    height: opts.height ?? 30,
    exitOnCtrlC: false,
    useMouse: true,
  })
  const { api, start } = await connect(world.ctx, opts.ref)
  const app = createBoardApp(
    t.renderer,
    api,
    { ...start, unicode: true, color: opts.color ?? false },
    { pollMs: opts.pollMs, saveWaitMs: opts.saveWaitMs },
  )
  await app.ready
  await idle(app.store)
  let quit = false
  void app.done.then(() => {
    quit = true
  })

  // Key presses are handled as they are sent; this waits for the requests they started.
  const frame = async () => {
    await idle(app.store)
    await t.renderOnce()
    return t.captureCharFrame()
  }
  const keys = t.mockInput
  return {
    app,
    store: app.store,
    // Keys sent without waiting for anything, for tests that act while requests are out.
    keys,
    frame,
    // The frame as runs of text with their colours.
    spans: async () => {
      await frame()
      return t.captureSpans()
    },
    // Waits until the frame satisfies `check`, for what runs on timers (polling).
    async waitFor(check: (frame: string) => boolean) {
      let last = ""
      await until(async () => {
        last = await frame()
        return check(last)
      }).catch(() => {
        throw new Error(`frame never matched:\n${last}`)
      })
      return last
    },
    press: async (...names: string[]) => {
      for (const name of names) keys.pressKey(name)
      return frame()
    },
    type: async (text: string) => {
      await keys.typeText(text)
      return frame()
    },
    enter: async () => {
      keys.pressEnter()
      return frame()
    },
    // A lone ESC is told apart from Alt+key by a short timeout, so wait it out.
    escape: async () => {
      keys.pressEscape()
      await Bun.sleep(60)
      return frame()
    },
    arrow: async (
      dir: "up" | "down" | "left" | "right",
      mods: { meta?: boolean; shift?: boolean } = {},
    ) => {
      keys.pressArrow(dir, mods)
      return frame()
    },
    // Clicks hit what was last drawn, so draw first.
    click: async (x: number, y: number) => {
      await frame()
      await t.mockMouse.click(x, y)
      return frame()
    },
    ctrlC: async () => {
      keys.pressCtrlC()
      return frame()
    },
    get quit() {
      return quit
    },
    close() {
      app.dispose()
      t.renderer.destroy()
    },
  }
}

export type Board = Awaited<ReturnType<typeof openBoard>>

// The rows of a frame, without trailing blanks.
export const rows = (frame: string) =>
  frame
    .replace(/\n$/, "")
    .split("\n")
    .map((r) => r.trimEnd())

/** The non-blank lines inside the board column titled `title` ("Todo (2)"), top to bottom. */
export function columnLines(frame: string, title: string): string[] {
  const all = frame.split("\n")
  const top = all.findIndex((r) => r.includes(`─ ${title} (`))
  if (top < 0) throw new Error(`no column ${title} in:\n${frame}`)
  const row = all[top] ?? ""
  const at = row.indexOf(`─ ${title} (`)
  const start = row.lastIndexOf("╭", at)
  const end = row.indexOf("╮", at)
  const out: string[] = []
  for (const line of all.slice(top + 1)) {
    if (line[start] === "╰") break
    out.push(line.slice(start + 1, end).trim())
  }
  return out.filter(Boolean)
}

// The task keys a column shows, top to bottom.
export const columnKeys = (frame: string, title: string) =>
  columnLines(frame, title).flatMap((l) => /WEB-\d+/.exec(l)?.[0] ?? [])
