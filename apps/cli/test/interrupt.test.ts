import { afterAll, beforeAll, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { removeSandboxes, startServer, type TestServer, world } from "./helpers"

// Ctrl+C: the CLI exits 3, after the other SIGINT listeners (OpenTUI's, which restores the
// terminal) have run; with an editor open the keypress is the editor's and the CLI carries on.
// The signal is raised inside the CLI by a preload, because a real Ctrl+C cannot be sent to a
// child on Windows.

const PRELOAD = resolve(import.meta.dir, "sigint-preload.ts")

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

const until = async (done: () => boolean, ms = 10_000) => {
  for (let waited = 0; !done(); waited += 20) {
    if (waited > ms) throw new Error("timed out")
    await Bun.sleep(20)
  }
}

const stillRunning = async (exited: Promise<number>, ms: number) =>
  (await Promise.race([exited, Bun.sleep(ms).then(() => "running" as const)])) === "running"

test("Ctrl+C while waiting exits 3, after the other listeners ran", async () => {
  const w = await world(server)
  const press = join(w.box.root, "press")
  const seen = join(w.box.root, "seen")
  // Waits for an approval in the browser that never comes.
  const login = w.box.start(["auth", "login", "--no-browser"], {
    bunArgs: ["--preload", PRELOAD],
    env: {
      INTESA_DEVICE_POLL_MS: "50",
      INTESA_TEST_SIGINT_FILE: press,
      INTESA_TEST_SIGINT_SEEN: seen,
    },
  })
  await login.waitForStderr(/one-time code/)
  writeFileSync(press, "")

  expect(await login.exited).toBe(3)
  expect(existsSync(seen)).toBe(true)
})

test("Ctrl+C while an editor is open is the editor's, and the temp file is cleaned up after", async () => {
  const w = await world(server)
  const task = await w.addTask({ title: "Edit me" })
  const press = join(w.box.root, "press")
  const started = join(w.box.root, "editor-started")
  const release = join(w.box.root, "editor-release")
  const editor = join(w.box.root, "slow-editor.ts")
  // Like vi, it takes the keypress itself and carries on until it is done.
  writeFileSync(
    editor,
    `process.on("SIGINT", () => {})
await Bun.write(${JSON.stringify(started)}, process.argv[2] ?? "")
while (!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(20)`,
  )
  const edit = w.box.start(["task", "edit", task.key], {
    bunArgs: ["--preload", PRELOAD],
    env: {
      INTESA_EDITOR: `"${process.execPath}" "${editor}"`,
      INTESA_TEST_SIGINT_FILE: press,
    },
  })
  await until(() => existsSync(started))
  const file = readFileSync(started, "utf8")
  expect(existsSync(file)).toBe(true)

  writeFileSync(press, "")
  await until(() => !existsSync(press))
  expect(await stillRunning(edit.exited, 700)).toBe(true)
  expect(existsSync(file)).toBe(true)

  writeFileSync(release, "")
  expect(await edit.exited).toBe(0)
  expect(edit.stderr()).toContain("No changes")
  expect(existsSync(dirname(file))).toBe(false)
})
