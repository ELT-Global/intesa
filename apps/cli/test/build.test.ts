import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import pkg from "../package.json" with { type: "json" }

const ROOT = resolve(import.meta.dir, "..")
const MAX_BUNDLE_BYTES = 1.5 * 1024 * 1024

let dir: string
let bundle: string

// Runs the build script (what `bun run build` runs), writing to a temp file.
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "intesa-build-"))
  bundle = join(dir, "intesa.js")
  const build = Bun.spawn([process.execPath, "scripts/build.ts", "--outfile", bundle], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, err] = await Promise.all([build.exited, new Response(build.stderr).text()])
  expect(code, err).toBe(0)
}, 60_000)

afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function run(args: string[]) {
  // Outside the repo, so the bundle must work without @opentui/core, config or node_modules.
  const proc = Bun.spawn([process.execPath, bundle, ...args], {
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1", INTESA_PROMPT_DISABLED: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

test("the bundle reports the package version", async () => {
  const r = await run(["--version"])
  expect(r.exitCode, r.stderr).toBe(0)
  expect(r.stdout.trim()).toBe(`intesa version ${pkg.version}`)
})

test("the bundle describes its commands as JSON", async () => {
  const r = await run(["schema"])
  expect(r.exitCode, r.stderr).toBe(0)
  const schema = JSON.parse(r.stdout)
  expect(schema.name).toBe("intesa")
  expect(schema.version).toBe(pkg.version)
})

test("the bundle stays small and carries no server code", () => {
  expect(statSync(bundle).size).toBeLessThan(MAX_BUNDLE_BYTES)
  const text = readFileSync(bundle, "utf8")
  expect(text).not.toContain("kysely")
  expect(text).not.toMatch(/require\(["']pg["']\)|from ?["']pg["']/)
})
