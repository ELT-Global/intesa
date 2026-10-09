import { afterAll, beforeAll, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  removeSandboxes,
  type Sandbox,
  sandbox,
  startServer,
  type TestServer,
  world,
} from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

const PRELOAD = resolve(import.meta.dir, "record-modules.ts")

// The modules a run loaded, as /-separated paths.
async function loaded(box: Sandbox, args: string[]) {
  const file = join(box.root, "modules.txt")
  const r = await box.run(args, {
    bunArgs: ["--preload", PRELOAD],
    env: { INTESA_TEST_MODULES: file },
  })
  expect(r.exitCode, r.stderr).toBe(0)
  return readFileSync(file, "utf8")
    .split("\n")
    .map((path) => path.replaceAll("\\", "/"))
}

// Commands load per noun, so a task command never pays for prompts, the board's TUI or the
// other nouns.
const strangers = (modules: string[]) =>
  modules.filter((m) => {
    const command = m.split("/apps/cli/src/commands/")[1]
    return (
      /@clack|@opentui|\/apps\/cli\/src\/tui\//.test(m) ||
      (command !== undefined && command !== "index.ts" && !command.startsWith("task/"))
    )
  })

test("`task list` loads the task commands and nothing heavier", async () => {
  const w = await world(server)
  await w.addTask({ title: "One" })
  const modules = await loaded(w.box, ["task", "list", "-p", "WEB"])
  expect(modules.some((m) => m.endsWith("/src/commands/task/list.ts"))).toBe(true)
  expect(strangers(modules)).toEqual([])
})

test("`task --help` too, without a server", async () => {
  const modules = await loaded(sandbox(), ["task", "--help"])
  expect(modules.some((m) => m.endsWith("/src/commands/task/index.ts"))).toBe(true)
  expect(strangers(modules)).toEqual([])
})
