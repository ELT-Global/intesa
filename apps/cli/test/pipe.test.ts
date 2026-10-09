import { afterAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { removeSandboxes, sandbox } from "./helpers"

afterAll(removeSandboxes)

const MAIN = resolve(import.meta.dir, "../src/main.ts")

// Bun reads a child's stdout eagerly, so a reader inside this process never makes the child
// hit a closed pipe. This needs a real one: `intesa schema | reader`, where the reader exits
// after its first chunk. `watch.ts` runs the CLI on the pipe's write end and records how it
// ended, because a shell pipeline only reports the reader's exit code.
const WATCH = `
const p = Bun.spawn([process.env.CLI_BUN, process.env.CLI_MAIN, "schema"], {
  stdin: "ignore", stdout: "inherit", stderr: "pipe",
})
const [stderr, exitCode] = await Promise.all([new Response(p.stderr).text(), p.exited])
await Bun.write("result.json", JSON.stringify({ stderr, exitCode }))
`
const READER = `process.stdin.once("data", () => process.exit(0))`

describe("a reader that closes stdout early", () => {
  test("`intesa schema | head` exits quietly with 0, no stack trace", async () => {
    const box = sandbox()
    writeFileSync(join(box.root, "watch.ts"), WATCH)
    writeFileSync(join(box.root, "reader.ts"), READER)
    const shell = process.platform === "win32" ? ["cmd", "/c"] : ["sh", "-c"]
    const pipeline = Bun.spawn([...shell, "bun watch.ts | bun reader.ts"], {
      cwd: box.root,
      env: {
        ...process.env,
        CLI_BUN: process.execPath,
        CLI_MAIN: MAIN,
        INTESA_CONFIG_DIR: box.configDir,
        INTESA_SECRETS: "file",
        INTESA_PROMPT_DISABLED: "1",
      },
      stdout: "ignore",
      stderr: "ignore",
    })
    await pipeline.exited
    const result = await Bun.file(join(box.root, "result.json")).json()
    expect(result).toEqual({ stderr: "", exitCode: 0 })
  })
})
