import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { nouns } from "../src/commands"
import {
  lines,
  loginAs,
  removeSandboxes,
  type Sandbox,
  sandbox,
  startServer,
  type TestServer,
  world,
} from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

const SHELLS = ["bash", "zsh", "fish", "powershell"]

// `intesa __complete --word=<partial> -- <words before it>`: what the scripts call.
const complete = (box: Sandbox, word: string, ...words: string[]) =>
  box.run(["__complete", `--word=${word}`, "--", ...words])

describe("intesa completion", () => {
  test.each(SHELLS)("%s: prints a script that asks `intesa __complete`", async (shell) => {
    const r = await sandbox().run(["completion", shell])
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toBe("")
    expect(r.stdout).toContain("intesa __complete")
    // An empty word survives Windows PowerShell only inside `--word=`.
    expect(r.stdout).toContain("--word=")
  })

  test("the shell is required and validated", async () => {
    expect((await sandbox().run(["completion"])).exitCode).toBe(2)
    const r = await sandbox().run(["completion", "tcsh"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("bash|zsh|fish|powershell")
  })

  test("__complete stays out of help and schema", async () => {
    const box = sandbox()
    const [help, schema] = await Promise.all([box.run(["--help"]), box.run(["schema"])])
    expect(help.stdout).not.toContain("__complete")
    expect(schema.stdout).not.toContain("__complete")
  })
})

// The bash script is exercised for real where a working bash exists, with `intesa` a
// function that runs this checkout.
const bash = await (async () => {
  const path = Bun.which("bash")
  if (!path) return undefined
  try {
    const probe = Bun.spawn([path, "-c", "echo $BASH_VERSION"], {
      stdout: "pipe",
      stderr: "ignore",
    })
    return (await new Response(probe.stdout).text()).trim() ? path : undefined
  } catch {
    return undefined
  }
})()

describe.skipIf(!bash)("bash script", () => {
  let script = ""
  let box: Sandbox
  beforeAll(async () => {
    box = sandbox()
    script = (await box.run(["completion", "bash"])).stdout
  })

  async function bashComplete(words: string[]) {
    const unix = (path: string) => path.replaceAll("\\", "/")
    const main = unix(resolve(import.meta.dir, "../src/main.ts"))
    const call = [
      `intesa() { "${unix(process.execPath)}" "${main}" "$@"; }`,
      `COMP_WORDS=(${words.map((w) => `'${w}'`).join(" ")})`,
      `COMP_CWORD=${words.length - 1}`,
      "_intesa",
      `printf "%s\\n" "\${COMPREPLY[@]}"`,
    ].join("\n")
    const proc = Bun.spawn([bash as string, "-s"], {
      stdin: new Blob([`${script}\n${call}\n`]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, INTESA_CONFIG_DIR: box.configDir, MSYS_NO_PATHCONV: "1" },
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return lines(out.replaceAll("\r", ""))
  }

  test("completes command names, with aliases", async () => {
    expect(await bashComplete(["intesa", "to"])).toEqual(["token"])
    expect(await bashComplete(["intesa", ""])).toEqual(
      expect.arrayContaining(["api", "config", "me", "ws"]),
    )
  })

  test("completes a group's subcommands, flags and flag values", async () => {
    expect((await bashComplete(["intesa", "token", ""])).sort()).toEqual([
      "create",
      "list",
      "ls",
      "revoke",
    ])
    const flags = await bashComplete(["intesa", "token", "create", "--"])
    expect(flags).toEqual(
      expect.arrayContaining(["--name", "--scope", "--expires", "--json", "--dry-run"]),
    )
    expect(flags).not.toContain("--code")
    expect(await bashComplete(["intesa", "token", "create", "--scope", ""])).toEqual([
      "read",
      "write",
    ])
  })
})

describe("__complete", () => {
  test("lists the commands, never itself", async () => {
    const r = await complete(sandbox(), "")
    expect(r.exitCode).toBe(0)
    const found = lines(r.stdout)
    for (const noun of nouns) expect(found).toContain(noun.name)
    expect(found).not.toContain("__complete")
  })

  test("filters by what has been typed", async () => {
    expect(lines((await complete(sandbox(), "tok")).stdout)).toEqual(["token"])
  })

  test("lists a group's subcommands and aliases", async () => {
    const r = await complete(sandbox(), "", "token")
    expect(lines(r.stdout).sort()).toEqual(["create", "list", "ls", "revoke"])
  })

  test("global flags may come first", async () => {
    const r = await complete(sandbox(), "cr", "-w", "acme", "token")
    expect(lines(r.stdout)).toEqual(["create"])
  })

  test("lists a command's flags, including global ones", async () => {
    const found = lines((await complete(sandbox(), "--", "token", "create")).stdout)
    expect(found).toEqual(
      expect.arrayContaining(["--name", "--scope", "--expires", "--json", "--yes"]),
    )
    expect(found).not.toContain("--version")
  })

  test("offers --no-x for a switch that is on by default", async () => {
    const found = lines((await complete(sandbox(), "--no", "token", "list")).stdout)
    expect(found).toEqual(["--no-color"])
  })

  test("completes the values of an enum flag, after the flag or inline", async () => {
    const box = sandbox()
    expect(lines((await complete(box, "", "token", "create", "--scope")).stdout)).toEqual([
      "read",
      "write",
    ])
    expect(lines((await complete(box, "w", "token", "create", "--scope")).stdout)).toEqual([
      "write",
    ])
    expect(lines((await complete(box, "--scope=r", "token", "create")).stdout)).toEqual([
      "--scope=read",
    ])
  })

  test("a flag value is not mistaken for a command word", async () => {
    const r = await complete(sandbox(), "", "token", "create", "--name", "ci", "--scope")
    expect(lines(r.stdout)).toEqual(["read", "write"])
  })

  test("completes enum arguments by position", async () => {
    const box = sandbox()
    expect(lines((await complete(box, "", "completion")).stdout)).toEqual(SHELLS)
    expect(lines((await complete(box, "e", "me", "2fa")).stdout)).toEqual(["enable"])
    // The second argument of `2fa` does not exist.
    expect((await complete(box, "", "me", "2fa", "enable")).stdout).toBe("")
  })

  test("garbage prints nothing and still exits 0", async () => {
    const box = sandbox()
    for (const args of [
      ["zzz"],
      ["token", "frob", "--scope"],
      ["--bogus", "token"],
      ["token", "create", "--bogus", "--scope", "--"],
      ["", "", ""],
    ]) {
      const r = await complete(box, "q", ...args)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toBe("")
      expect(r.stderr).toBe("")
    }
    for (const argv of [["__complete", "--bogus"], ["__complete", "-w"], ["__complete"]]) {
      const r = await box.run(argv)
      expect(r.exitCode, argv.join(" ")).toBe(0)
      expect(r.stderr).toBe("")
    }
  })

  test("a missing --word is treated as empty", async () => {
    const r = await sandbox().run(["__complete", "--", "token"])
    expect(r.exitCode).toBe(0)
    expect(lines(r.stdout).sort()).toEqual(["create", "list", "ls", "revoke"])
  })

  describe("dynamic arguments", () => {
    test("`token revoke` offers the ids of your tokens", async () => {
      const box = sandbox(server.url)
      const { tokenId } = await loginAs(box, server, "complete-1@example.com")
      const created = (await box.run(["token", "create", "--name", "x", "--json"])).json()

      const all = lines((await complete(box, "", "token", "revoke")).stdout)
      expect(all.sort()).toEqual([created.id, tokenId].sort())
      const some = lines((await complete(box, created.id.slice(0, 8), "token", "revoke")).stdout)
      expect(some).toEqual([created.id])
    })

    test("values are looked up where -w and -p on the line say", async () => {
      const w = await world(server)
      await w.addTag("home")
      const other = (
        await w.session.call("POST", "/api/workspaces", { name: "Other", slug: `other-${w.id}` })
      ).body.workspace
      await w.session.call("POST", `/api/workspaces/${other.id}/tags`, { name: "away" })
      await w.session.call("POST", `/api/workspaces/${other.id}/projects`, {
        name: "Api",
        key: "API",
      })
      const tags = (...words: string[]) => complete(w.box, "", "tag", "delete", ...words)
      expect(lines((await tags("-w", other.slug)).stdout)).toEqual(["away"])
      expect(lines((await tags(`--workspace=${w.workspace.slug}`)).stdout)).toEqual(["home"])
      const keys = await complete(w.box, "", "-w", other.slug, "project", "view")
      expect(lines(keys.stdout)).toEqual(["API"])
    })

    test("a failing source (not signed in) prints nothing, quietly", async () => {
      const r = await complete(sandbox(server.url), "", "token", "revoke")
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toBe("")
      expect(r.stderr).toBe("")
    })

    test("an unreachable server prints nothing, quietly", async () => {
      const r = await complete(sandbox("http://127.0.0.1:1"), "", "token", "revoke")
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toBe("")
      expect(r.stderr).toBe("")
    })
  })
})
