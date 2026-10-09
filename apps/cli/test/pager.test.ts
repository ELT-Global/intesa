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

// A pager that saves what it is fed to a file; returns the command line and the file.
let n = 0
function fakePager(box: Sandbox) {
  const dir = join(box.root, "pagers")
  mkdirSync(dir, { recursive: true })
  const script = join(dir, `pager-${++n}.ts`)
  const out = join(dir, `received-${n}.txt`)
  writeFileSync(script, "await Bun.write(process.argv[2], await Bun.stdin.text())\n")
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

// A person at a terminal, as far as the CLI can tell without one.
const TERMINAL = { INTESA_FORCE_TTY: "100", INTESA_PROMPT_DISABLED: undefined, NO_COLOR: "1" }

describe("the pager", () => {
  test("`task view` goes through INTESA_PAGER on a terminal", async () => {
    const pager = fakePager(w.box)
    const r = await w.box.run(["task", "view", "WEB-1"], {
      env: { ...TERMINAL, INTESA_PAGER: pager.command },
    })
    expect(r.exitCode, r.stderr).toBe(0)
    expect(r.stdout).toBe("")
    const received = readFileSync(pager.out, "utf8")
    expect(received).toContain("WEB-1  Plan the launch")
    expect(received).toContain("bold")
  })

  test("so do `project view` and a Markdown `artifact view`", async () => {
    const pager = fakePager(w.box)
    const env = { ...TERMINAL, INTESA_PAGER: pager.command }
    const project = await w.box.run(["project", "view", "WEB"], { env })
    expect(project.stdout).toBe("")
    expect(readFileSync(pager.out, "utf8")).toContain("Web")

    const artifact = await w.box.run(["artifact", "view", "WEB-1", "notes.md"], { env })
    expect(artifact.stdout).toBe("")
    expect(readFileSync(pager.out, "utf8")).toContain("Paged text.")
  })

  test("without a pager the output goes straight to stdout", async () => {
    // No PAGER, no INTESA_PAGER: Windows has no default, elsewhere `less` copies it through.
    const r = await w.box.run(["task", "view", "WEB-1"], { env: TERMINAL })
    expect(r.exitCode, r.stderr).toBe(0)
    expect(r.stdout).toContain("WEB-1  Plan the launch")
  })

  test("piped output never uses the pager", async () => {
    const pager = fakePager(w.box)
    const r = await w.box.run(["task", "view", "WEB-1"], { env: { INTESA_PAGER: pager.command } })
    expect(r.stdout).toContain("Plan the launch")
    expect(existsSync(pager.out)).toBe(false)
  })

  test("data is not paged: --json, -q and --fields print directly", async () => {
    const pager = fakePager(w.box)
    const env = { ...TERMINAL, INTESA_PAGER: pager.command }
    for (const flags of [["--json"], ["-q"], ["--fields", "key,title"]]) {
      const r = await w.box.run(["task", "view", "WEB-1", ...flags], { env })
      expect(r.stdout, flags.join(" ")).toContain("WEB-1")
    }
    expect(existsSync(pager.out)).toBe(false)
  })

  test("commands that are not views are not paged", async () => {
    const pager = fakePager(w.box)
    const r = await w.box.run(["task", "list", "-p", "WEB"], {
      env: { ...TERMINAL, INTESA_PAGER: pager.command },
    })
    expect(r.stdout).toContain("Plan the launch")
    expect(existsSync(pager.out)).toBe(false)
  })

  test("nobody to read it (CI, prompts disabled, `prompt disabled`): no pager", async () => {
    const pager = fakePager(w.box)
    const env = { ...TERMINAL, INTESA_PAGER: pager.command }
    for (const extra of [{ CI: "1" }, { INTESA_PROMPT_DISABLED: "1" }]) {
      const r = await w.box.run(["task", "view", "WEB-1"], { env: { ...env, ...extra } })
      expect(r.stdout, JSON.stringify(extra)).toContain("Plan the launch")
    }
    expect(existsSync(pager.out)).toBe(false)
  })

  test("the pager config key wins over INTESA_PAGER and PAGER", async () => {
    const [chosen, ignored] = [fakePager(w.box), fakePager(w.box)]
    configPager(w.box, chosen.command)
    const r = await w.box.run(["task", "view", "WEB-1"], {
      env: { ...TERMINAL, INTESA_PAGER: ignored.command, PAGER: ignored.command },
    })
    expect(r.stdout).toBe("")
    expect(readFileSync(chosen.out, "utf8")).toContain("Plan the launch")
    expect(existsSync(ignored.out)).toBe(false)
    configPager(w.box, undefined)
  })

  test("INTESA_PAGER wins over PAGER", async () => {
    const [chosen, ignored] = [fakePager(w.box), fakePager(w.box)]
    await w.box.run(["task", "view", "WEB-1"], {
      env: { ...TERMINAL, INTESA_PAGER: chosen.command, PAGER: ignored.command },
    })
    expect(existsSync(chosen.out)).toBe(true)
    expect(existsSync(ignored.out)).toBe(false)
  })

  test("`cat` and an empty pager config turn it off", async () => {
    const pager = fakePager(w.box)
    const cat = await w.box.run(["task", "view", "WEB-1"], {
      env: { ...TERMINAL, INTESA_PAGER: "cat", PAGER: pager.command },
    })
    expect(cat.stdout).toContain("Plan the launch")

    configPager(w.box, "")
    const off = await w.box.run(["task", "view", "WEB-1"], {
      env: { ...TERMINAL, INTESA_PAGER: pager.command },
    })
    configPager(w.box, undefined)
    expect(off.stdout).toContain("Plan the launch")
    expect(existsSync(pager.out)).toBe(false)
  })

  test("a pager that cannot be started falls back to printing", async () => {
    const r = await w.box.run(["task", "view", "WEB-1"], {
      env: { ...TERMINAL, INTESA_PAGER: "intesa-no-such-pager --x" },
    })
    expect(r.exitCode, r.stderr).toBe(0)
    expect(r.stdout).toContain("Plan the launch")
  })
})

describe("pagerCommand", () => {
  const none = { platform: "linux", hasLess: false }

  test("config, then INTESA_PAGER, then PAGER, split like other commands", () => {
    const env = { INTESA_PAGER: "bat --paging=always", PAGER: "more" }
    expect(pagerCommand({ env, configPager: '"C:\\Tools\\my pager.exe" -x', ...none })).toEqual([
      "C:\\Tools\\my pager.exe",
      "-x",
    ])
    expect(pagerCommand({ env, ...none })).toEqual(["bat", "--paging=always"])
    expect(pagerCommand({ env: { PAGER: "more" }, ...none })).toEqual(["more"])
  })

  test("empty or cat means none, and the first one set decides", () => {
    expect(pagerCommand({ env: { INTESA_PAGER: "", PAGER: "less" }, ...none })).toBeUndefined()
    expect(pagerCommand({ env: { PAGER: "/bin/cat" }, ...none })).toBeUndefined()
    expect(pagerCommand({ env: { PAGER: "less" }, configPager: "", ...none })).toBeUndefined()
  })

  test("with nothing set: less where there is one, never on Windows", () => {
    expect(pagerCommand({ env: {}, platform: "linux", hasLess: true })).toEqual(["less"])
    expect(pagerCommand({ env: {}, platform: "linux", hasLess: false })).toBeUndefined()
    expect(pagerCommand({ env: {}, platform: "win32", hasLess: true })).toBeUndefined()
  })
})
