import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pagerCommand } from "../src/io/pager"
import {
  removeSandboxes,
  type Sandbox,
  startServer,
  type TestServer,
  type World,
  world,
} from "./helpers"

let server: TestServer
let w: World
beforeAll(async () => {
  server = await startServer()
  w = await world(server)
  const task = await w.addTask({ title: "Plan the launch", body: "Use **bold** words.\n" })
  const form = new FormData()
  form.append("file", new File(["# Notes\n\nPaged text.\n"], "notes.md", { type: "text/markdown" }))
  const upload = await w.session.request(`/api/tasks/${task.id}/artifacts`, {
    method: "POST",
    body: form,
  })
  if (upload.status !== 201) throw new Error(`upload failed: ${upload.status}`)
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

// A pager that saves what it is fed to a file, then exits with `exitCode`; returns the
// command line and the file.
let n = 0
function fakePager(box: Sandbox, exitCode = 0) {
  const dir = join(box.root, "pagers")
  mkdirSync(dir, { recursive: true })
  const script = join(dir, `pager-${++n}.ts`)
  const out = join(dir, `received-${n}.txt`)
  writeFileSync(
    script,
    `await Bun.write(process.argv[2], await Bun.stdin.text())\nprocess.exit(${exitCode})\n`,
  )
  return { command: `"${process.execPath}" "${script}" "${out}"`, out }
}

// Sets (or, with undefined, removes) the pager key of the sandbox's config.json.
function configPager(box: Sandbox, value: string | undefined) {
  const file = join(box.configDir, "config.json")
  const config = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  if (value === undefined) delete config.pager
  else config.pager = value
  mkdirSync(box.configDir, { recursive: true })
  writeFileSync(file, JSON.stringify(config))
}

// Runs `args` in a terminal, as a person would; returns the exit code and what the terminal
// showed.
async function atTerminal(args: string[], env: Record<string, string | undefined> = {}) {
  const t = w.box.terminal(args, { env: { NO_COLOR: "1", ...env } })
  const exitCode = await t.finish()
  return { exitCode, output: t.output() }
}
const VIEW = ["task", "view", "WEB-1"]

describe("the pager", () => {
  test("`task view` goes through INTESA_PAGER at a terminal", async () => {
    const pager = fakePager(w.box)
    const r = await atTerminal(VIEW, { INTESA_PAGER: pager.command })
    expect(r.exitCode, r.output).toBe(0)
    expect(r.output).not.toContain("Plan the launch")
    const received = readFileSync(pager.out, "utf8")
    expect(received).toContain("WEB-1  Plan the launch")
    expect(received).toContain("bold")
  })

  test("so do `project view` and a Markdown `artifact view`", async () => {
    const pager = fakePager(w.box)
    const env = { INTESA_PAGER: pager.command }
    const project = await atTerminal(["project", "view", "WEB"], env)
    expect(project.output).not.toContain("Web")
    expect(readFileSync(pager.out, "utf8")).toContain("Web")

    const artifact = await atTerminal(["artifact", "view", "WEB-1", "notes.md"], env)
    expect(artifact.output).not.toContain("Paged text.")
    expect(readFileSync(pager.out, "utf8")).toContain("Paged text.")
  })

  test("without a pager the output goes straight to the terminal", async () => {
    // No PAGER, no INTESA_PAGER: Windows has no default, elsewhere `less` copies it through.
    const r = await atTerminal(VIEW)
    expect(r.exitCode, r.output).toBe(0)
    expect(r.output).toContain("Plan the launch")
  })

  test("piped output never uses the pager, even formatted for a terminal", async () => {
    const pager = fakePager(w.box)
    const piped = await w.box.run(VIEW, { env: { INTESA_PAGER: pager.command } })
    expect(piped.stdout).toContain("Plan the launch")

    // INTESA_FORCE_TTY changes the formatting only: nobody is there to page for.
    const forced = await w.box.run(VIEW, {
      env: {
        INTESA_FORCE_TTY: "100",
        INTESA_PROMPT_DISABLED: undefined,
        INTESA_PAGER: pager.command,
      },
    })
    expect(forced.exitCode, forced.stderr).toBe(0)
    expect(forced.stdout).toContain("WEB-1  Plan the launch")
    expect(existsSync(pager.out)).toBe(false)
  })

  test("data is not paged: --json, -q and --fields print directly", async () => {
    const pager = fakePager(w.box)
    for (const flags of [["--json"], ["-q"], ["--fields", "key,title"]]) {
      const r = await atTerminal([...VIEW, ...flags], { INTESA_PAGER: pager.command })
      expect(r.output, flags.join(" ")).toContain("WEB-1")
    }
    expect(existsSync(pager.out)).toBe(false)
  })

  test("commands that are not views are not paged", async () => {
    const pager = fakePager(w.box)
    const r = await atTerminal(["task", "list", "-p", "WEB"], { INTESA_PAGER: pager.command })
    expect(r.output).toContain("Plan the launch")
    expect(existsSync(pager.out)).toBe(false)
  })

  test("nobody to read it (CI, prompts disabled): no pager", async () => {
    const pager = fakePager(w.box)
    for (const extra of [{ CI: "1" }, { INTESA_PROMPT_DISABLED: "1" }]) {
      const r = await atTerminal(VIEW, { INTESA_PAGER: pager.command, ...extra })
      expect(r.output, JSON.stringify(extra)).toContain("Plan the launch")
    }
    expect(existsSync(pager.out)).toBe(false)
  })

  test("INTESA_PAGER wins over the pager config key, which wins over PAGER", async () => {
    const [mine, configured, shell] = [fakePager(w.box), fakePager(w.box), fakePager(w.box)]
    configPager(w.box, configured.command)
    try {
      await atTerminal(VIEW, { INTESA_PAGER: mine.command, PAGER: shell.command })
      expect(readFileSync(mine.out, "utf8")).toContain("Plan the launch")
      expect(existsSync(configured.out)).toBe(false)

      await atTerminal(VIEW, { PAGER: shell.command })
      expect(readFileSync(configured.out, "utf8")).toContain("Plan the launch")
      expect(existsSync(shell.out)).toBe(false)
    } finally {
      configPager(w.box, undefined)
    }
  })

  test("`cat` and an empty pager config turn it off", async () => {
    const pager = fakePager(w.box)
    const cat = await atTerminal(VIEW, { INTESA_PAGER: "cat", PAGER: pager.command })
    expect(cat.output).toContain("Plan the launch")

    configPager(w.box, "")
    const off = await atTerminal(VIEW, { PAGER: pager.command })
    configPager(w.box, undefined)
    expect(off.output).toContain("Plan the launch")
    expect(existsSync(pager.out)).toBe(false)
  })

  test("a pager that cannot be started falls back to printing", async () => {
    const r = await atTerminal(VIEW, { INTESA_PAGER: "intesa-no-such-pager --x" })
    expect(r.exitCode, r.output).toBe(0)
    expect(r.output).toContain("Plan the launch")
  })

  test("a pager that fails says so", async () => {
    const pager = fakePager(w.box, 3)
    const r = await atTerminal(VIEW, { INTESA_PAGER: pager.command })
    expect(r.exitCode, r.output).toBe(0)
    expect(readFileSync(pager.out, "utf8")).toContain("Plan the launch")
    expect(r.output).toMatch(/exited with 3/)
  })
})

describe("pagerCommand", () => {
  const none = { platform: "linux", hasLess: false }

  test("INTESA_PAGER, then config, then PAGER, split like other commands", () => {
    const env = { INTESA_PAGER: "bat --paging=always", PAGER: "more" }
    const configPager = '"C:\\Tools\\my pager.exe" -x'
    expect(pagerCommand({ env, configPager, ...none })).toEqual(["bat", "--paging=always"])
    expect(pagerCommand({ env: { PAGER: "more" }, configPager, ...none })).toEqual([
      "C:\\Tools\\my pager.exe",
      "-x",
    ])
    expect(pagerCommand({ env: { PAGER: "more" }, ...none })).toEqual(["more"])
  })

  test("empty or cat means none, and the first one set decides", () => {
    expect(pagerCommand({ env: { INTESA_PAGER: "", PAGER: "less" }, ...none })).toBeUndefined()
    expect(pagerCommand({ env: { PAGER: "/bin/cat" }, ...none })).toBeUndefined()
    const gitCat = "C:\\Program Files\\Git\\usr\\bin\\cat.exe"
    expect(pagerCommand({ env: { PAGER: `"${gitCat}"` }, ...none })).toBeUndefined()
    expect(pagerCommand({ env: { PAGER: "less" }, configPager: "", ...none })).toBeUndefined()
    expect(pagerCommand({ env: { INTESA_PAGER: "more" }, configPager: "", ...none })).toEqual([
      "more",
    ])
  })

  test("with nothing set: less where there is one, never on Windows", () => {
    expect(pagerCommand({ env: {}, platform: "linux", hasLess: true })).toEqual(["less"])
    expect(pagerCommand({ env: {}, platform: "linux", hasLess: false })).toBeUndefined()
    expect(pagerCommand({ env: {}, platform: "win32", hasLess: true })).toBeUndefined()
  })
})
