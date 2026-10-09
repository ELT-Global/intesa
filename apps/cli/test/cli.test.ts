import { afterAll, describe, expect, test } from "bun:test"
import pkg from "../package.json"
import { removeSandboxes, sandbox } from "./helpers"

afterAll(removeSandboxes)

describe("version", () => {
  test("--version prints the package version", async () => {
    const r = await sandbox().run(["--version"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe(`intesa version ${pkg.version}\n`)
    expect(r.stderr).toBe("")
  })

  test("--version --json prints an object", async () => {
    const r = await sandbox().run(["--version", "--json"])
    expect(r.json()).toEqual({ version: pkg.version })
  })
})

describe("help", () => {
  // Golden output: agents read help, so changes must be deliberate (`bun test -u`).
  test("root help", async () => {
    const r = await sandbox().run(["--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatchSnapshot()
  })

  test("help api", async () => {
    const r = await sandbox().run(["help", "api"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatchSnapshot()
  })

  test("bare `intesa` prints root help to stdout", async () => {
    const box = sandbox()
    const [bare, flag] = await Promise.all([box.run([]), box.run(["--help"])])
    expect(bare.exitCode).toBe(0)
    expect(bare.stdout).toBe(flag.stdout)
  })

  test("`<command> --help` and `help <command>` agree, wherever -h appears", async () => {
    const box = sandbox()
    const [a, b, c] = await Promise.all([
      box.run(["api", "--help"]),
      box.run(["help", "api"]),
      box.run(["-h", "api", "/health"]),
    ])
    expect(a.stdout).toBe(b.stdout)
    expect(c.stdout).toBe(b.stdout)
  })

  test("a command group lists its subcommands", async () => {
    const r = await sandbox().run(["config", "--help"])
    expect(r.exitCode).toBe(0)
    for (const verb of ["get", "set", "list"]) expect(r.stdout).toContain(`${verb}:`)
    expect(r.stdout).toContain("USAGE\n  intesa config <command> [flags]")
  })

  test("help for a subcommand", async () => {
    const r = await sandbox().run(["help", "config", "set"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("intesa config set <key> <value>")
  })

  test("help exit-codes documents every code", async () => {
    const r = await sandbox().run(["help", "exit-codes"])
    expect(r.exitCode).toBe(0)
    for (const code of [0, 1, 2, 3, 4, 5, 6, 7, 8])
      expect(r.stdout).toMatch(new RegExp(`^ +${code} `, "m"))
  })

  test("help environment documents the variables", async () => {
    const r = await sandbox().run(["help", "environment"])
    for (const name of [
      "INTESA_TOKEN",
      "INTESA_HOST",
      "INTESA_CONFIG_DIR",
      "INTESA_SECRETS",
      "INTESA_HTTP_TIMEOUT_MS",
      "INTESA_EDITOR",
      "INTESA_PAGER",
      "PAGER",
    ]) {
      expect(r.stdout).toContain(name)
    }
  })

  test("help for an unknown topic is a usage error", async () => {
    const r = await sandbox().run(["help", "nope"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('unknown help topic "nope"')
  })
})

describe("usage errors exit 2", () => {
  test("unknown command", async () => {
    const r = await sandbox().run(["frobnicate"])
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toBe("")
    expect(r.stderr).toContain('unknown command "frobnicate" for "intesa"')
  })

  test("unknown subcommand", async () => {
    const r = await sandbox().run(["config", "frob"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('unknown command "frob" for "intesa config"')
  })

  test("unknown flag is named, with a pointer to help", async () => {
    const r = await sandbox().run(["api", "/health", "--bogus"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("unknown flag: --bogus")
    expect(r.stderr).toContain("intesa api --help")
  })

  test("flag without its value", async () => {
    const r = await sandbox().run(["api", "/health", "-X"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--method")
  })

  test("missing argument", async () => {
    const r = await sandbox().run(["config", "set", "editor"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("missing argument <value>")
  })

  test("too many arguments", async () => {
    const r = await sandbox().run(["config", "get", "editor", "pager"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('unexpected argument "pager"')
  })

  test("with --json the error is a JSON envelope on stderr and stdout is empty", async () => {
    const r = await sandbox().run(["api", "/health", "--bogus", "--json"])
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toBe("")
    const { error } = JSON.parse(r.stderr)
    expect(error).toEqual({
      code: "USAGE_ERROR",
      message: "unknown flag: --bogus",
      exitCode: 2,
      hint: "Run `intesa api --help` for usage.",
    })
  })
})
