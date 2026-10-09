import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { removeSandboxes, sandbox } from "./helpers"

afterAll(removeSandboxes)

describe("intesa config", () => {
  test("set, get and list round-trip through config.json", async () => {
    const box = sandbox()
    expect((await box.run(["config", "set", "editor", "vim -f"])).exitCode).toBe(0)
    expect((await box.run(["config", "set", "workspace", "acme"])).exitCode).toBe(0)

    const get = await box.run(["config", "get", "editor"])
    expect(get.exitCode).toBe(0)
    expect(get.stdout).toBe("vim -f\n")

    const list = await box.run(["config", "list"])
    expect(list.exitCode).toBe(0)
    expect(list.stdout).toContain("editor\tvim -f\n")
    expect(list.stdout).toContain("workspace\tacme\n")

    const json = await box.run(["config", "list", "--json"])
    expect(json.json()).toContainEqual({ key: "editor", value: "vim -f" })
    expect(json.json().map((e: { key: string }) => e.key)).toEqual([
      "host",
      "workspace",
      "project",
      "editor",
      "pager",
      "browser",
      "prompt",
      "color",
    ])

    const file = JSON.parse(readFileSync(join(box.configDir, "config.json"), "utf8"))
    expect(file).toEqual({ editor: "vim -f", workspace: "acme" })
  })

  test("get --json and an unset key", async () => {
    const box = sandbox()
    const r = await box.run(["config", "get", "pager", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({ key: "pager", value: null })
    const plain = await box.run(["config", "get", "pager"])
    expect(plain.stdout).toBe("")
  })

  test("defaults show in list for keys that have one", async () => {
    const r = await sandbox().run(["config", "list", "--json"])
    expect(r.json()).toContainEqual({ key: "color", value: "auto" })
    expect(r.json()).toContainEqual({ key: "prompt", value: "enabled" })
  })

  test("--fields narrows list output", async () => {
    const box = sandbox()
    await box.run(["config", "set", "pager", "less"])
    const r = await box.run(["config", "list", "--fields", "value"])
    expect(r.stdout.split("\n")).toContain("less")
    const bad = await box.run(["config", "list", "--fields", "nope"])
    expect(bad.exitCode).toBe(2)
    expect(bad.stderr).toContain('unknown field "nope"')
  })

  test("host values are normalised to an origin", async () => {
    const box = sandbox()
    await box.run(["config", "set", "host", "localhost:3000/"])
    expect((await box.run(["config", "get", "host"])).stdout).toBe("http://localhost:3000\n")
  })

  test("unknown keys and invalid values are usage errors", async () => {
    const box = sandbox()
    const key = await box.run(["config", "set", "colour", "never"])
    expect(key.exitCode).toBe(2)
    expect(key.stderr).toContain('unknown config key "colour"')
    const value = await box.run(["config", "set", "color", "purple"])
    expect(value.exitCode).toBe(2)
    expect(value.stderr).toContain("color")
  })
})
