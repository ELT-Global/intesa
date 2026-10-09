import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { requireProject, requireWorkspace, resolveContext } from "../src/client/context"
import { CliError } from "../src/output/errors"
import { fakeServer, removeSandboxes, sandbox } from "./helpers"

// Each candidate host answers with its own name, so the output shows which one was used.
const names = ["flag", "env", "file", "config"] as const
const hosts = {} as Record<(typeof names)[number], ReturnType<typeof fakeServer>>
beforeAll(() => {
  for (const name of names) hosts[name] = fakeServer(() => Response.json({ host: name }))
})
afterAll(() => {
  for (const name of names) hosts[name].stop()
  removeSandboxes()
})

describe("host resolution (end to end)", () => {
  test("--host > INTESA_HOST > nearest .intesa.json > config default", async () => {
    const box = sandbox()
    await box.run(["config", "set", "host", hosts.config.url])
    const repo = join(box.root, "repo")
    const nested = join(repo, "packages", "deep")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(repo, ".intesa.json"), JSON.stringify({ host: hosts.file.url }))

    const used = async (args: string[], env: Record<string, string | undefined>, cwd: string) => {
      const r = await box.run(["api", "/health", ...args], { env, cwd })
      expect(r.exitCode).toBe(0)
      return r.json().host
    }
    const env = { INTESA_HOST: hosts.env.url }
    expect(await used(["--host", hosts.flag.url], env, nested)).toBe("flag")
    expect(await used([], env, nested)).toBe("env")
    expect(await used([], { INTESA_HOST: undefined }, nested)).toBe("file")
    expect(await used([], { INTESA_HOST: undefined }, box.root)).toBe("config")
  })
})

describe("workspace and project resolution", () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })
  const tree = (local: object) => {
    const root = mkdtempSync(join(tmpdir(), "intesa-ctx-"))
    dirs.push(root)
    const cwd = join(root, "a", "b")
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(root, ".intesa.json"), JSON.stringify(local))
    return { root, cwd }
  }
  const config = { workspace: "cfg-ws", project: "CFG" }

  test("follows flag > env > .intesa.json > config, per value", () => {
    const { cwd } = tree({ workspace: "file-ws", project: "FILE" })
    const env = { INTESA_WORKSPACE: "env-ws", INTESA_PROJECT: "ENV" }
    const at = (flags: object, e: Record<string, string>) =>
      resolveContext({ flags, env: e, cwd, config, hosts: [] })

    const all = at({ workspace: "flag-ws", project: "FLAG" }, env)
    expect(all.workspace).toEqual({ value: "flag-ws", source: "flag" })
    expect(all.project).toEqual({ value: "FLAG", source: "flag" })

    const fromEnv = at({ workspace: "flag-ws" }, env)
    expect(fromEnv.project).toEqual({ value: "ENV", source: "env" })

    const fromFile = at({}, {})
    expect(fromFile.workspace?.value).toBe("file-ws")
    expect(fromFile.workspace?.source).toBe("file")
  })

  test("falls back to config when no .intesa.json is found", () => {
    const outside = mkdtempSync(join(tmpdir(), "intesa-ctx-"))
    dirs.push(outside)
    const r = resolveContext({ flags: {}, env: {}, cwd: outside, config, hosts: [] })
    expect(r.workspace).toEqual({ value: "cfg-ws", source: "config" })
    expect(r.project).toEqual({ value: "CFG", source: "config" })
  })

  test("a .intesa.json without a key does not mask config for that key", () => {
    const { cwd } = tree({ project: "FILE" })
    const r = resolveContext({ flags: {}, env: {}, cwd, config, hosts: [] })
    expect(r.workspace?.source).toBe("config")
    expect(r.project?.source).toBe("file")
  })

  test("the only logged-in host is the last resort", () => {
    const outside = mkdtempSync(join(tmpdir(), "intesa-ctx-"))
    dirs.push(outside)
    const one = resolveContext({
      flags: {},
      env: {},
      cwd: outside,
      config: {},
      hosts: ["https://a.example"],
    })
    expect(one.host).toEqual({ value: "https://a.example", source: "hosts" })
    const two = resolveContext({
      flags: {},
      env: {},
      cwd: outside,
      config: {},
      hosts: ["https://a.example", "https://b.example"],
    })
    expect(two.host).toBeUndefined()
  })

  test("a missing workspace or project is a usage error naming the flag", () => {
    const outside = mkdtempSync(join(tmpdir(), "intesa-ctx-"))
    dirs.push(outside)
    const r = resolveContext({ flags: {}, env: {}, cwd: outside, config: {}, hosts: [] })
    const errorOf = (fn: () => unknown) => {
      try {
        fn()
      } catch (e) {
        return e as CliError
      }
      throw new Error("expected an error")
    }
    const ws = errorOf(() => requireWorkspace(r))
    expect(ws).toBeInstanceOf(CliError)
    expect(ws.exitCode).toBe(2)
    expect(ws.message).toContain("--workspace")
    expect(errorOf(() => requireProject(r)).message).toContain("--project")
  })

  test("a malformed .intesa.json is reported, not ignored", () => {
    const root = mkdtempSync(join(tmpdir(), "intesa-ctx-"))
    dirs.push(root)
    writeFileSync(join(root, ".intesa.json"), "{ nope")
    expect(() => resolveContext({ flags: {}, env: {}, cwd: root, config: {}, hosts: [] })).toThrow(
      ".intesa.json",
    )
  })
})
