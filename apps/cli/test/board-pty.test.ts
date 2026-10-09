import { afterAll, beforeAll, expect, test } from "bun:test"
import { until } from "./board-world"
import { removeSandboxes, startServer, type TestServer, world } from "./helpers"

// The real `intesa board`, run in a pseudo-terminal as a person would run it: what the test
// renderer cannot show is whether the terminal is taken over and given back.

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

test("the board takes over the terminal, and Ctrl+C gives it back and exits", async () => {
  const w = await world(server)
  await w.addTask({ title: "Hello card", assigneeIds: [w.me] })
  // Debug logging is on, and must not write over the board.
  const t = w.box.terminal(["board", "WEB"], { env: { INTESA_DEBUG: "1" } })
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
