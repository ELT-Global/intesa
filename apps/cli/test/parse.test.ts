import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { CliError } from "../src/output/errors"
import { defineCommand } from "../src/registry/define"
import { parseCommand } from "../src/registry/parse"

const move = defineCommand({
  name: "move",
  summary: "Move a thing",
  args: [
    { name: "task", required: true },
    { name: "status", enum: ["todo", "done"] },
    { name: "rest", variadic: true },
  ],
  flags: z.object({
    top: z.boolean().default(false),
    draft: z.boolean().default(true),
    label: z.array(z.string()).default([]).meta({ short: "l" }),
    state: z.enum(["open", "closed"]).optional(),
    limit: z.number().int().positive().default(30).meta({ short: "L" }),
    dryRunLabel: z.string().optional(),
  }),
  run() {},
})

const usageError = (argv: string[]) => {
  try {
    parseCommand(move, argv)
  } catch (e) {
    expect(e).toBeInstanceOf(CliError)
    expect((e as CliError).exitCode).toBe(2)
    return (e as CliError).message
  }
  throw new Error(`expected a usage error for ${argv.join(" ")}`)
}

describe("parseCommand", () => {
  test("applies defaults and maps positionals to named args", () => {
    const { flags, args, globals } = parseCommand(move, ["WEB-1"])
    expect(flags).toEqual({ top: false, draft: true, label: [], limit: 30 })
    expect(args).toEqual({ task: "WEB-1", status: undefined, rest: [] })
    expect(globals.json).toBe(false)
    expect(globals.color).toBe(true)
  })

  test("booleans take --x and --no-x", () => {
    expect(parseCommand(move, ["T", "--top", "--no-draft"]).flags).toMatchObject({
      top: true,
      draft: false,
    })
  })

  test("repeated flags collect into arrays, long and short", () => {
    const { flags } = parseCommand(move, ["T", "-l", "a", "--label", "b", "-lc"])
    expect(flags.label).toEqual(["a", "b", "c"])
  })

  test("camelCase keys are kebab-case flags", () => {
    expect(parseCommand(move, ["T", "--dry-run-label", "x"]).flags.dryRunLabel).toBe("x")
  })

  test("numbers are coerced and validated", () => {
    expect(parseCommand(move, ["T", "-L", "5"]).flags.limit).toBe(5)
    expect(usageError(["T", "-L", "five"])).toContain("--limit")
    expect(usageError(["T", "--limit=-1"])).toContain("--limit")
  })

  test("enums list the allowed values", () => {
    const message = usageError(["T", "--state", "merged"])
    expect(message).toContain("--state")
    expect(message).toContain("open")
  })

  test("enum positionals are validated", () => {
    expect(usageError(["T", "later"])).toBe(
      'invalid value "later" for <status>: expected todo|done',
    )
  })

  test("-- ends flag parsing", () => {
    const { flags, args } = parseCommand(move, ["T", "done", "--", "--top", "-x"])
    expect(flags.top).toBe(false)
    expect(args.rest).toEqual(["--top", "-x"])
  })

  test("unknown flags are named", () => {
    expect(usageError(["T", "--nope"])).toBe("unknown flag: --nope")
    expect(usageError(["T", "-z"])).toBe("unknown flag: -z")
    expect(usageError(["T", "--no-state"])).toBe("unknown flag: --no-state")
  })

  test("a value given to a boolean, or missing from a string, names the flag", () => {
    expect(usageError(["T", "--top=yes"])).toContain("--top")
    expect(usageError(["T", "--state"])).toContain("--state")
  })

  test("missing and extra arguments", () => {
    expect(usageError([])).toBe("missing argument <task>")
    const noRest = defineCommand({ name: "one", summary: "One", args: [{ name: "a" }], run() {} })
    expect(() => parseCommand(noRest, ["x", "y"])).toThrow('unexpected argument "y"')
  })

  test("global flags mix with command flags anywhere", () => {
    const { globals, flags } = parseCommand(move, [
      "--json",
      "T",
      "-w",
      "acme",
      "--top",
      "--no-color",
    ])
    expect(globals).toMatchObject({ json: true, workspace: "acme", color: false })
    expect(flags.top).toBe(true)
  })

  test("a nullable value flag is cleared with --no-x", () => {
    const edit = defineCommand({
      name: "edit",
      summary: "Edit",
      args: [{ name: "rest", variadic: true }],
      flags: z.object({ note: z.string().nullable().optional() }),
      run() {},
    })
    expect(parseCommand(edit, ["--no-note"]).flags.note).toBeNull()
    expect(parseCommand(edit, ["--note", "x"]).flags.note).toBe("x")
    expect(parseCommand(edit, []).flags.note).toBeUndefined()
    expect(parseCommand(edit, ["--", "--no-note"]).args.rest).toEqual(["--no-note"])
    expect(() => parseCommand(edit, ["--note", "x", "--no-note"])).toThrow("conflict")
    expect(() => parseCommand(move, ["T", "--no-label"])).toThrow("unknown flag: --no-label")
  })

  test("a flag without a default must be given, and the error says so", () => {
    const pick = defineCommand({
      name: "pick",
      summary: "Pick",
      flags: z.object({ kind: z.enum(["a", "b"]), note: z.string() }),
      run() {},
    })
    expect(() => parseCommand(pick, ["--note", "x"])).toThrow("missing --kind (one of a|b)")
    expect(() => parseCommand(pick, ["--kind", "a"])).toThrow("missing --note")
    expect(parseCommand(pick, ["--kind", "b", "--note", "x"]).flags).toEqual({
      kind: "b",
      note: "x",
    })
  })

  test("--no-color is the only global spelling, so commands may have a --color", () => {
    const paint = defineCommand({
      name: "paint",
      summary: "Paint",
      flags: z.object({ color: z.enum(["red", "blue"]).optional() }),
      run() {},
    })
    const { globals, flags } = parseCommand(paint, ["--color", "red", "--no-color"])
    expect(flags.color).toBe("red")
    expect(globals.color).toBe(false)
    expect(parseCommand(paint, []).globals.color).toBe(true)
    expect(usageError(["T", "--color"])).toBe("unknown flag: --color")
    // Their --no-color would be the global's.
    for (const color of [z.string().nullable().optional(), z.boolean().default(false)]) {
      expect(() =>
        defineCommand({ name: "x", summary: "X", flags: z.object({ color }), run() {} }),
      ).toThrow("--no-color")
    }
  })

  test("command flags may not shadow global flags", () => {
    expect(() =>
      defineCommand({ name: "x", summary: "X", flags: z.object({ host: z.string() }), run() {} }),
    ).toThrow("--host")
    expect(() =>
      defineCommand({
        name: "x",
        summary: "X",
        flags: z.object({ wide: z.boolean().meta({ short: "w" }) }),
        run() {},
      }),
    ).toThrow("-w")
  })
})
