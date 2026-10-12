import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import pkg from "../package.json"

// The npm package as it would be published: staged once, then run the way npm's shims run it
// (Node) and the way Bun runs it.

const root = join(import.meta.dir, "..")
const out = mkdtempSync(join(tmpdir(), "intesa-npm-"))
const launcher = join(out, "bin", "intesa.js")
const node = Bun.which("node")
const npm = Bun.which("npm")

const run = (cmd: string[], env: Record<string, string | undefined> = process.env) => {
  const p = Bun.spawnSync(cmd, { cwd: out, env: { ...env, NO_COLOR: "1" } })
  return { exitCode: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() }
}

beforeAll(() => {
  const staged = Bun.spawnSync([process.execPath, join(root, "scripts", "npm.ts"), "--outdir", out])
  if (staged.exitCode !== 0) throw new Error(staged.stderr.toString())
}, 60_000)

afterAll(() => rmSync(out, { recursive: true, force: true }))

describe("the npm package", () => {
  test("is named intesa, at the CLI's version, MIT, with a bin", () => {
    const manifest = JSON.parse(readFileSync(join(out, "package.json"), "utf8"))
    expect(manifest).toMatchObject({
      name: "intesa",
      version: pkg.version,
      license: "MIT",
      bin: { intesa: "bin/intesa.js" },
      optionalDependencies: { "@opentui/core": pkg.dependencies["@opentui/core"] },
    })
    expect(manifest.dependencies).toBeUndefined()
    expect(readFileSync(launcher, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true)
  })

  test.skipIf(!npm)(
    "contains only the launcher, the bundle, the README and the licence",
    () => {
      const packed = run([npm as string, "pack", "--dry-run", "--json"])
      expect(packed.exitCode).toBe(0)
      const files = JSON.parse(packed.stdout)[0].files.map((f: { path: string }) => f.path)
      expect(files.sort()).toEqual(
        ["LICENSE", "README.md", "bin/intesa.js", "intesa.js", "package.json"].sort(),
      )
    },
    60_000,
  )

  test("runs under Bun", () => {
    const r = run([process.execPath, launcher, "--version"])
    expect(r.stdout.trim()).toBe(`intesa version ${pkg.version}`)
    expect(r.exitCode).toBe(0)
  })

  test.skipIf(!node)("runs under Node by handing over to bun, passing the exit code on", () => {
    expect(run([node as string, launcher, "--version"]).stdout.trim()).toBe(
      `intesa version ${pkg.version}`,
    )
    // No server configured: not signed in, exit 4.
    const env: Record<string, string | undefined> = {
      ...process.env,
      INTESA_CONFIG_DIR: join(out, "config"),
      INTESA_TOKEN: "",
      INTESA_HOST: undefined,
    }
    const r = run([node as string, launcher, "--json", "me"], env)
    expect(r.exitCode).toBe(4)
    expect(JSON.parse(r.stderr).error.code).toBe("NOT_LOGGED_IN")
  })

  test.skipIf(!node)("says how to get Bun when it is missing", () => {
    // Only Node's own directory on PATH, so `bun` cannot be found.
    const r = run([node as string, launcher, "--version"], { PATH: dirname(node as string) })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain("https://bun.sh")
  })
})
