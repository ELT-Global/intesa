import { afterAll, describe, expect, test } from "bun:test"
import pkg from "../package.json"
import { nouns } from "../src/commands"
import { removeSandboxes, sandbox } from "./helpers"

afterAll(removeSandboxes)

describe("intesa schema", () => {
  test("describes every command, the global flags and the exit codes", async () => {
    const r = await sandbox().run(["schema"])
    expect(r.exitCode).toBe(0)
    const schema = r.json()
    expect(schema.name).toBe("intesa")
    expect(schema.version).toBe(pkg.version)
    expect(schema.globalFlags.type).toBe("object")
    expect(Object.keys(schema.globalFlags.properties)).toContain("dry-run")
    expect(schema.exitCodes.map((e: { code: number }) => e.code)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ])
    expect(schema.exitCodes[4]).toMatchObject({ code: 4, name: "AUTH" })

    const commands = schema.commands.map((c: { command: string }) => c.command)
    for (const c of ["intesa api", "intesa config get", "intesa config set", "intesa schema"]) {
      expect(commands).toContain(c)
    }
    for (const c of schema.commands) {
      expect(typeof c.summary).toBe("string")
      expect(c.flags.type).toBe("object")
      expect(Array.isArray(c.args)).toBe(true)
    }
  })

  test("lists every error code with its exit code, the CLI's own included", async () => {
    const { errorCodes } = (await sandbox().run(["schema", "api"])).json()
    const exitOf = (code: string) =>
      errorCodes.find((e: { code: string }) => e.code === code)?.exitCode
    expect(exitOf("NOT_FOUND")).toBe(5)
    expect(exitOf("USAGE_ERROR")).toBe(2)
    expect(exitOf("NOT_LOGGED_IN")).toBe(4)
    for (const code of ["EDITOR_ERROR", "ACCESS_DENIED", "DEVICE_CODE_EXPIRED", "CANCELLED"]) {
      expect(exitOf(code)).toBeNumber()
    }
  })

  test("flags without a default are required", async () => {
    const [create] = (await sandbox().run(["schema", "field", "create"])).json().commands
    expect(create.flags.required).toEqual(["type"])
  })

  test("documents output fields for commands that have them", async () => {
    const r = await sandbox().run(["schema", "config", "list"])
    expect(r.json().commands).toHaveLength(1)
    expect(r.json().commands[0].output).toEqual({ name: "config", fields: ["key", "value"] })
  })

  // Golden output: the agent contract for a command must not drift unnoticed.
  test("schema api", async () => {
    const r = await sandbox().run(["schema", "api"])
    expect(r.exitCode).toBe(0)
    expect(r.json().commands).toMatchSnapshot()
  })

  test("a noun selects its whole group", async () => {
    const r = await sandbox().run(["schema", "config"])
    const commands = r.json().commands.map((c: { command: string }) => c.command)
    expect(commands).toEqual(["intesa config get", "intesa config list", "intesa config set"])
  })

  test("an unknown command is a usage error", async () => {
    const r = await sandbox().run(["schema", "nope"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('unknown command "nope"')
  })

  // Root help is rendered from the index without loading command modules, so it must agree
  // with what the modules declare.
  test("the lazy command index matches the command modules", async () => {
    for (const noun of nouns) {
      const mod = await noun.load()
      expect({ name: mod.name, aliases: mod.aliases ?? [], summary: mod.summary }).toEqual({
        name: noun.name,
        aliases: noun.aliases ?? [],
        summary: noun.summary,
      })
    }
  })
})
