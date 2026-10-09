import { afterAll, expect, test } from "bun:test"
import { removeSandboxes, sandbox } from "./helpers"

afterAll(removeSandboxes)

test("`intesa board` refuses to run without a terminal (exit 2) before any request", async () => {
  // No server at all: the check comes first.
  const box = sandbox("http://127.0.0.1:9")
  const r = await box.run(["board", "WEB"])
  expect(r.exitCode).toBe(2)
  expect(r.stderr).toBe("error: board needs an interactive terminal; use `intesa task list`\n")
  expect(r.stdout).toBe("")
  // Nothing was drawn: no escape sequences reached the pipe.
  expect(r.stderr).not.toContain("\x1b")
})

test("`intesa board --help` describes the board", async () => {
  const r = await sandbox().run(["board", "--help"])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain("intesa board [<key>]")
  expect(r.stdout).toContain("Press ? on the board for every key.")
})

test("`intesa board` refuses --dry-run and --json, which a full-screen board cannot honour", async () => {
  const box = sandbox("http://127.0.0.1:9")
  const dry = await box.run(["board", "WEB", "--dry-run"])
  expect(dry.exitCode).toBe(2)
  expect(dry.stderr).toBe("error: board does not take --dry-run; use the `intesa task` commands\n")
  const json = await box.run(["board", "--json"])
  expect(json.exitCode).toBe(2)
  expect(JSON.parse(json.stderr).error).toMatchObject({
    code: "USAGE_ERROR",
    message: "board does not take --json; use the `intesa task` commands",
  })
})
