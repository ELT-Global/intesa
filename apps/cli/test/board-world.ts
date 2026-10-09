import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTestRenderer } from "@opentui/core/testing"
import { addMember, signIn } from "../../api/test/helpers"
import { createHttp } from "../src/client/http"
import { type Ctx, globalFlags } from "../src/registry/define"
import { connect } from "../src/tui/api"
import { createBoardApp } from "../src/tui/app"
import type { TestServer } from "./helpers"

let n = 0
const dirs: string[] = []

export function removeBoardDirs() {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary response shapes
type Json = any

/**
 * A signed-in user ("Alan Owner") who owns a workspace with a WEB project, plus the context
 * the board would get from the CLI. Requests go to the real server; `failWrites` makes the
 * next PATCHes fail with a 500, as a broken server would.
 */
export async function boardWorld(server: TestServer, opts: { editor?: string } = {}) {
  const slug = `acme${++n}`
  const email = `${slug}@example.com`
  const session = await signIn(server.app, email, "Alan Owner")
  await session.call("PATCH", "/api/me", { name: "Alan Owner" })
  const workspace = (await session.call("POST", "/api/workspaces", { name: "Acme", slug })).body
    .workspace as { id: string; slug: string }
  const project = (
    await session.call("POST", `/api/workspaces/${workspace.id}/projects`, {
      name: "Web",
      key: "WEB",
    })
  ).body.project as { id: string; key: string }
  const token = (await session.call("POST", "/api/me/tokens", { name: "board test" })).body
    .token as string
  const me = (await session.call("GET", "/api/me")).body.user.id as string

  const faults = { failWrites: false }
  const http = createHttp({
    host: server.url,
    token,
    dryRun: false,
    debug: "off",
    stdout: () => {},
    stderr: () => {},
    fetch: (async (req: Request) => {
      if (faults.failWrites && req.method === "PATCH") {
        return Response.json({ code: "INTERNAL", message: "boom" }, { status: 500 })
      }
      return fetch(req)
    }) as typeof fetch,
  })
  const dir = mkdtempSync(join(tmpdir(), "intesa-board-"))
  dirs.push(dir)
  const ctx = {
    globals: globalFlags.parse({}),
    env: {},
    cwd: dir,
    mode: { tty: true, color: false, width: 120 },
    configDir: dir,
    // Never the platform editor: a test that edits by mistake fails instead of waiting.
    config: { editor: opts.editor ?? `"${process.execPath}" -e process.exit(1)` },
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

  const addTask = async (body: Record<string, unknown>): Promise<Json> => {
    const res = await session.call("POST", `/api/projects/${project.id}/tasks`, body)
    if (res.status !== 201) throw new Error(`task creation failed: ${JSON.stringify(res.body)}`)
    return res.body.task
  }
  const getTask = async (id: string): Promise<Json> =>
    (await session.call("GET", `/api/tasks/${id}`)).body?.task
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

  return {
    ctx,
    faults,
    me,
    workspace,
    project,
    addTask,
    getTask,
    deleteTask,
    projectTasks,
    column,
    addPerson,
  }
}

export type BoardWorld = Awaited<ReturnType<typeof boardWorld>>

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The board on OpenTUI's test renderer, with helpers to press keys and read frames. */
export async function openBoard(
  world: BoardWorld,
  opts: { ref?: string; width?: number; height?: number } = {},
) {
  const t = await createTestRenderer({
    width: opts.width ?? 120,
    height: opts.height ?? 30,
    exitOnCtrlC: false,
    useMouse: true,
  })
  const { api, start } = await connect(world.ctx, opts.ref)
  const app = createBoardApp(t.renderer, api, { ...start, unicode: true, color: false })
  await app.ready
  await app.store.idle()
  let quit = false
  void app.done.then(() => {
    quit = true
  })

  // Lets key handlers and any requests they started finish, then draws.
  const frame = async () => {
    await pause(5)
    await app.store.idle()
    await t.renderOnce()
    return t.captureCharFrame()
  }
  const keys = t.mockInput
  return {
    app,
    store: app.store,
    frame,
    // Waits until the frame satisfies `check` (for the timers a toast or a poll runs on).
    async waitFor(check: (frame: string) => boolean) {
      let last = ""
      for (let i = 0; i < 100; i++) {
        last = await frame()
        if (check(last)) return last
        await pause(20)
      }
      throw new Error(`frame never matched:\n${last}`)
    },
    press: async (...names: string[]) => {
      for (const name of names) {
        keys.pressKey(name)
        await pause(2)
      }
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
      await pause(60)
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
