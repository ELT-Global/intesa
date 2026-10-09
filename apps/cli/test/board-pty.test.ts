import { afterAll, beforeAll, expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { until } from "./board-world"
import { removeSandboxes, startServer, type TestServer, type World, world } from "./helpers"

// The real `intesa board`, run in a pseudo-terminal as a person would run it: what the test
// renderer cannot show is whether the terminal is taken over and given back.

const MAIN = resolve(import.meta.dir, "../src/main.ts")
const ENTER_SCREEN = "\x1b[?1049h"
const LEAVE_SCREEN = "\x1b[?1049l"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

function inTerminal(w: World, args: string[], extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^(INTESA_|NO_COLOR$|CLICOLOR|CI$|VISUAL$|EDITOR$|BROWSER$)/.test(k)) {
      env[k] = v
    }
  }
  Object.assign(env, {
    INTESA_CONFIG_DIR: w.box.configDir,
    INTESA_SECRETS: "file",
    INTESA_HOST: server.url,
    ...extraEnv,
  })
  let output = ""
  const decoder = new TextDecoder()
  const proc = Bun.spawn([process.execPath, MAIN, ...args], {
    cwd: join(w.box.root, "work"),
    env,
    terminal: {
      cols: 120,
      rows: 30,
      data: (_, bytes) => {
        output += decoder.decode(bytes, { stream: true })
      },
    },
  })
  return { proc, output: () => output, type: (text: string) => proc.terminal?.write(text) }
}

test("the board takes over the terminal, and Ctrl+C gives it back and exits", async () => {
  const w = await world(server)
  await w.addTask({ title: "Hello card", assigneeIds: [w.me] })
  // Debug logging is on, and must not write over the board.
  const t = inTerminal(w, ["board", "WEB"], { INTESA_DEBUG: "1" })
  try {
    await until(() => t.output().includes("WEB-1"), 10_000)
    expect(t.output()).toContain(ENTER_SCREEN)
    expect(t.output()).toContain("Todo (1)")
    expect(t.output()).toContain("In progress (0)")

    t.type("\x03")
    const exited = await Promise.race([t.proc.exited, Bun.sleep(5000).then(() => "timeout")])
    expect(exited).toBe(0)
    const out = t.output()
    expect(out).toContain(LEAVE_SCREEN)
    const board = out.slice(out.indexOf(ENTER_SCREEN), out.lastIndexOf(LEAVE_SCREEN))
    expect(board).not.toContain("> GET")
  } finally {
    t.proc.kill()
    t.proc.terminal?.close()
  }
}, 20_000)
