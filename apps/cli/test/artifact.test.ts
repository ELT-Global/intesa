import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { MAX_ARTIFACT_BYTES } from "@intesa/api/artifacts"
import { editorCommand } from "../src/io/editor"
import { removeSandboxes, type Sandbox, startServer, type TestServer, world } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

const FIXTURES = resolve(import.meta.dir, "../../../e2e/fixtures/artifacts")
const fixture = (name: string) => join(FIXTURES, name)

type Listed = { id: string; name: string; mimeType: string; size: number; url: string }

// A signed-in sandbox whose user owns one workspace with one task.
async function setup(opts: { scope?: "read" | "write" } = {}) {
  const w = await world(server, opts)
  const { box, session } = w
  const task = (await w.addTask({ title: "T" })) as { id: string; key: string }
  const onServer = async (): Promise<Listed[]> =>
    (await session.call("GET", `/api/tasks/${task.id}/artifacts`)).body.artifacts
  const contentOf = async (id: string) =>
    new Uint8Array(
      await (await session.request(`/api/tasks/${task.id}/artifacts/${id}`)).arrayBuffer(),
    )
  const text = async (id: string) => new TextDecoder().decode(await contentOf(id))
  return { box, session, task, onServer, contentOf, text }
}

// Writes a file under the sandbox directory (not its cwd, unless the path says so).
function put(box: Sandbox, path: string, content: string | Uint8Array) {
  const full = join(box.root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  return full
}
const inWork = (box: Sandbox, name: string) => join(box.root, "work", name)

// A command line for an editor that runs a bun script; the script gets the file path last.
function fakeEditor(box: Sandbox, name: string, source: string) {
  const script = put(box, `editors/${name}.ts`, source)
  return `"${process.execPath}" "${script}"`
}
// Without a terminal, only an editor set for intesa itself is used.
const editor = (command: string) => ({ INTESA_EDITOR: command })
const APPEND = `import { appendFileSync } from "node:fs"
appendFileSync(process.argv[2], "\\nEdited in the editor.\\n")`
const NOOP = `// opens and closes without touching the file`
const FAIL = "process.exit(3)"

// The CLI logs "> METHOD url" for every request it sends when INTESA_DEBUG is set.
const DEBUG = { INTESA_DEBUG: "1" }
const sent = (stderr: string, method: string) => stderr.includes(`> ${method} `)

describe("artifact upload", () => {
  test("uploads files in order and prints the artifacts", async () => {
    const { box, onServer, contentOf, task } = await setup()
    const md = put(box, "files/plan.md", "# Plan\n\nShip it.\n")
    const r = await box.run(["artifact", "upload", task.key, md, fixture("brief.pdf"), "--json"])
    expect(r.exitCode).toBe(0)
    const out = r.json() as Listed[]
    expect(out.map((a) => [a.name, a.mimeType])).toEqual([
      ["plan.md", "text/markdown"],
      ["brief.pdf", "application/pdf"],
    ])
    expect(out[0]?.url).toBe(`${server.url}/api/tasks/${task.id}/artifacts/${out[0]?.id}`)

    const stored = await onServer()
    expect(stored.map((a) => a.id)).toEqual(out.map((a) => a.id))
    expect(await contentOf(out[1]?.id ?? "")).toEqual(
      new Uint8Array(readFileSync(fixture("brief.pdf"))),
    )
  })

  test("-q prints the new ids, one per line", async () => {
    const { box, onServer, task } = await setup()
    const a = put(box, "files/a.md", "a")
    const b = put(box, "files/b.md", "b")
    const r = await box.run(["artifact", "upload", task.key, a, b, "-q"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim().split("\n")).toEqual((await onServer()).map((x) => x.id))
  })

  test("a file with a disallowed extension exits 8 before any request is made", async () => {
    const { box, onServer, task } = await setup()
    const exe = put(box, "files/run.exe", "MZ")
    const r = await box.run(["artifact", "upload", task.key, exe], { env: DEBUG })
    expect(r.exitCode).toBe(8)
    expect(r.stderr).toContain("run.exe")
    expect(r.stderr).toContain("Only HTML, PDF, Markdown, Word and OpenDocument files")
    expect(r.stderr).not.toContain("> ")
    expect(await onServer()).toEqual([])
  })

  test("a file over the size limit exits 8 before any request is made", async () => {
    const { box, onServer, task } = await setup()
    const big = put(box, "files/big.pdf", new Uint8Array(MAX_ARTIFACT_BYTES + 1))
    const r = await box.run(["artifact", "upload", task.key, big], { env: DEBUG })
    expect(r.exitCode).toBe(8)
    expect(r.stderr).toContain("big.pdf: Artifacts must be 5 MB or smaller")
    expect(r.stderr).not.toContain("> ")
    expect(await onServer()).toEqual([])
  })

  test("one invalid file keeps the whole batch from uploading", async () => {
    const { box, onServer, task } = await setup()
    const good = put(box, "files/good.md", "ok")
    const bad = put(box, "files/bad.exe", "MZ")
    const r = await box.run(["artifact", "upload", task.key, good, bad])
    expect(r.exitCode).toBe(8)
    expect(r.stdout).toBe("")
    expect(await onServer()).toEqual([])
  })

  test("a missing file is a usage error naming the path", async () => {
    const { box, task } = await setup()
    const r = await box.run(["artifact", "upload", task.key, "nope.md"], { env: DEBUG })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("nope.md")
    expect(r.stderr).not.toContain("> ")
  })

  test("at least one file is required", async () => {
    const { box, task } = await setup()
    const r = await box.run(["artifact", "upload", task.key])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("missing argument <file>")
  })

  test("stops at the first server rejection, exits with its code and still prints what was uploaded", async () => {
    const { box, onServer, task } = await setup()
    const first = put(box, "files/first.md", "one")
    // Passes the local checks, but is not a PDF: only the server inspects the content.
    const fake = put(box, "files/fake.pdf", "not a pdf")
    const last = put(box, "files/last.md", "three")
    const r = await box.run(["artifact", "upload", task.key, first, fake, last, "--json"])
    expect(r.exitCode).toBe(8)
    expect(r.stderr).toContain("fake.pdf")
    expect(r.stderr).toContain("does not match its format")
    expect((r.json() as Listed[]).map((a) => a.name)).toEqual(["first.md"])
    expect((await onServer()).map((a) => a.name)).toEqual(["first.md"])
  })

  test("--continue-on-error uploads the rest, reports every failure and exits non-zero", async () => {
    const { box, onServer, task } = await setup()
    const first = put(box, "files/first.md", "one")
    const fake = put(box, "files/fake.pdf", "not a pdf")
    const exe = put(box, "files/run.exe", "MZ")
    const last = put(box, "files/last.md", "two")
    const r = await box.run([
      "artifact",
      "upload",
      task.key,
      first,
      fake,
      exe,
      last,
      "--continue-on-error",
      "--json",
    ])
    expect(r.exitCode).toBe(8)
    expect(r.stderr).toContain("fake.pdf")
    expect(r.stderr).toContain("run.exe")
    expect((r.json() as Listed[]).map((a) => a.name)).toEqual(["first.md", "last.md"])
    expect((await onServer()).map((a) => a.name)).toEqual(["first.md", "last.md"])
  })

  test("--continue-on-error exits 0 when nothing fails", async () => {
    const { box, task } = await setup()
    const a = put(box, "files/a.md", "a")
    const r = await box.run(["artifact", "upload", task.key, a, "--continue-on-error", "-q"])
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toBe("")
  })

  test("a read-only token cannot upload (exit 7)", async () => {
    const { box, task } = await setup({ scope: "read" })
    const md = put(box, "files/plan.md", "# Plan")
    expect((await box.run(["artifact", "upload", task.key, md])).exitCode).toBe(7)
  })
})

describe("artifact list", () => {
  test("lists a task's artifacts as JSON, with an alias for the noun", async () => {
    const { box, onServer, task } = await setup()
    await box.run(["artifact", "upload", task.key, fixture("brief.pdf"), fixture("brief.docx")])
    const r = await box.run(["a", "list", task.key, "--json"])
    expect(r.exitCode).toBe(0)
    const listed = r.json() as Listed[]
    expect(listed.map((a) => a.name)).toEqual(["brief.pdf", "brief.docx"])
    expect(listed.map((a) => a.id)).toEqual((await onServer()).map((a) => a.id))
    expect(listed[0]?.size).toBe(readFileSync(fixture("brief.pdf")).length)
  })

  test("piped output is TSV with the id first, and a task without artifacts prints nothing", async () => {
    const { box, task } = await setup()
    expect((await box.run(["artifact", "list", task.key])).stdout).toBe("")
    const up = await box.run(["artifact", "upload", task.key, fixture("brief.pdf"), "--json"])
    const [artifact] = up.json() as Listed[]
    const tsv = await box.run(["artifact", "list", task.key])
    expect(tsv.stdout.split("\n")[0]?.split("\t").slice(0, 3)).toEqual([
      artifact?.id ?? "",
      "brief.pdf",
      "application/pdf",
    ])
  })

  test("an unknown task exits 5", async () => {
    const { box } = await setup()
    expect((await box.run(["artifact", "list", "ZZ-99"])).exitCode).toBe(5)
  })
})

describe("artifact download", () => {
  test("writes ./<name> in the current directory, byte for byte", async () => {
    const { box, task } = await setup()
    await box.run(["artifact", "upload", task.key, fixture("brief.docx")])
    const r = await box.run(["artifact", "download", task.key, "brief.docx"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect(new Uint8Array(readFileSync(inWork(box, "brief.docx")))).toEqual(
      new Uint8Array(readFileSync(fixture("brief.docx"))),
    )
  })

  test("-o PATH writes there, and a directory receives the artifact under its name", async () => {
    const { box, task } = await setup()
    await box.run(["artifact", "upload", task.key, fixture("brief.pdf")])
    const to = join(box.root, "out", "copy.pdf")
    mkdirSync(dirname(to), { recursive: true })
    expect(
      (await box.run(["artifact", "download", task.key, "brief.pdf", "-o", to])).exitCode,
    ).toBe(0)
    expect(readFileSync(to)).toEqual(readFileSync(fixture("brief.pdf")))

    const dir = join(box.root, "dir")
    mkdirSync(dir)
    await box.run(["artifact", "download", task.key, "brief.pdf", "-o", dir])
    expect(readFileSync(join(dir, "brief.pdf"))).toEqual(readFileSync(fixture("brief.pdf")))
  })

  test("-o - writes the raw bytes to stdout and nothing else", async () => {
    const { box, task } = await setup()
    await box.run(["artifact", "upload", task.key, fixture("brief.docx")])
    const r = await box.run(["artifact", "download", task.key, "brief.docx", "-o", "-"])
    expect(r.exitCode).toBe(0)
    expect(r.stdoutBytes).toEqual(new Uint8Array(readFileSync(fixture("brief.docx"))))
    expect(r.stderr).toBe("")
    expect(existsSync(inWork(box, "brief.docx"))).toBe(false)
  })

  test("refuses to overwrite an existing file (exit 6) unless --force", async () => {
    const { box, task } = await setup()
    await box.run(["artifact", "upload", task.key, fixture("brief.pdf")])
    const target = put(box, "work/brief.pdf", "precious")
    const r = await box.run(["artifact", "download", task.key, "brief.pdf"])
    expect(r.exitCode).toBe(6)
    expect(r.stderr).toContain("--force")
    expect(readFileSync(target, "utf8")).toBe("precious")

    const forced = await box.run(["artifact", "download", task.key, "brief.pdf", "--force"])
    expect(forced.exitCode).toBe(0)
    expect(readFileSync(target)).toEqual(readFileSync(fixture("brief.pdf")))
  })

  test("finds the artifact by id and by a case-insensitive name", async () => {
    const { box, task } = await setup()
    const up = await box.run(["artifact", "upload", task.key, fixture("brief.pdf"), "--json"])
    const [artifact] = up.json() as Listed[]
    for (const ref of [artifact?.id ?? "", "BRIEF.PDF"]) {
      const r = await box.run(["artifact", "download", task.key, ref, "-o", "-"])
      expect(r.exitCode).toBe(0)
      expect(r.stdoutBytes).toEqual(new Uint8Array(readFileSync(fixture("brief.pdf"))))
    }
  })

  test("an exact name wins over a case-insensitive one", async () => {
    const { box, task } = await setup()
    const upper = put(box, "files/upper/Notes.md", "upper")
    const lower = put(box, "files/lower/notes.md", "lower")
    await box.run(["artifact", "upload", task.key, upper, lower])
    const r = await box.run(["artifact", "download", task.key, "notes.md", "-o", "-"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("lower")
  })

  test("an ambiguous name exits 2 listing the candidates; the id still works", async () => {
    const { box, task } = await setup()
    const first = put(box, "files/one/dup.md", "first")
    const second = put(box, "files/two/dup.md", "second")
    const up = await box.run(["artifact", "upload", task.key, first, second, "--json"])
    const [a, b] = up.json() as Listed[]

    const r = await box.run(["artifact", "download", task.key, "dup.md", "-o", "-"])
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toBe("")
    expect(r.stderr).toContain(a?.id ?? "?")
    expect(r.stderr).toContain(b?.id ?? "?")

    const byId = await box.run(["artifact", "download", task.key, b?.id ?? "", "-o", "-"])
    expect(byId.stdout).toBe("second")
  })

  test("an unknown artifact exits 5 and writes nothing", async () => {
    const { box, task } = await setup()
    const r = await box.run(["artifact", "download", task.key, "ghost.pdf"])
    expect(r.exitCode).toBe(5)
    expect(existsSync(inWork(box, "ghost.pdf"))).toBe(false)
  })
})

describe("artifact view", () => {
  test("prints a Markdown artifact's text when piped", async () => {
    const { box, task } = await setup()
    const md = put(box, "files/plan.md", "# Plan\n\nShip *it*.\n")
    await box.run(["artifact", "upload", task.key, md])
    const r = await box.run(["artifact", "view", task.key, "plan.md"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("# Plan\n\nShip *it*.\n")
  })

  test("renders it on a terminal", async () => {
    const { box, task } = await setup()
    const md = put(box, "files/plan.md", "# Plan\n\nShip **it**.\n")
    await box.run(["artifact", "upload", task.key, md])
    const r = await box.run(["artifact", "view", task.key, "plan.md"], {
      env: { INTESA_FORCE_TTY: "80" },
    })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Ship")
    expect(r.stdout).not.toContain("**it**")
  })

  test("--json adds the text to the artifact's fields", async () => {
    const { box, task } = await setup()
    const md = put(box, "files/plan.md", "hello")
    await box.run(["artifact", "upload", task.key, md])
    const r = await box.run(["artifact", "view", task.key, "plan.md", "--json"])
    expect(r.json()).toMatchObject({ name: "plan.md", mimeType: "text/markdown", content: "hello" })
  })

  test("other formats print their link when there is no terminal", async () => {
    const { box, task } = await setup()
    const up = await box.run(["artifact", "upload", task.key, fixture("brief.pdf"), "--json"])
    const [artifact] = up.json() as Listed[]
    const url = `${server.url}/api/tasks/${task.id}/artifacts/${artifact?.id}\n`
    const piped = await box.run(["artifact", "view", task.key, "brief.pdf"])
    expect(piped.exitCode).toBe(0)
    expect(piped.stdout).toBe(url)
    const flagged = await box.run(["artifact", "view", task.key, "brief.pdf", "--no-browser"])
    expect(flagged.stdout).toBe(url)
  })
})

describe("artifact edit", () => {
  test("saves what the editor wrote, under the same name", async () => {
    const { box, onServer, text, task } = await setup()
    const md = put(box, "files/plan.md", "# Plan\n")
    const up = await box.run(["artifact", "upload", task.key, md, "--json"])
    const [artifact] = up.json() as Listed[]

    const r = await box.run(["artifact", "edit", task.key, "plan.md", "--json"], {
      env: editor(fakeEditor(box, "append", APPEND)),
    })
    expect(r.exitCode).toBe(0)
    expect(await text(artifact?.id ?? "")).toBe("# Plan\n\nEdited in the editor.\n")
    expect(r.json()).toMatchObject({ id: artifact?.id, name: "plan.md" })
    expect((await onServer()).map((a) => a.name)).toEqual(["plan.md"])
  })

  test("the editor gets a file named like the artifact, in plain characters, with its text", async () => {
    const { box, task } = await setup()
    // & and % would be syntax to a `.cmd` editor on Windows.
    const md = put(box, "files/R&D 100%.md", "current text")
    await box.run(["artifact", "upload", task.key, md])
    const seen = join(box.root, "seen.json")
    const spy = fakeEditor(
      box,
      "spy",
      `import { basename } from "node:path"
import { readFileSync, writeFileSync } from "node:fs"
const path = process.argv[2]
writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ name: basename(path), text: readFileSync(path, "utf8") }))`,
    )
    await box.run(["artifact", "edit", task.key, "R&D 100%.md"], { env: editor(spy) })
    expect(JSON.parse(readFileSync(seen, "utf8"))).toEqual({
      name: "R_D_100_.md",
      text: "current text",
    })
  })

  test("an unchanged file says so, exits 0 and sends no update", async () => {
    const { box, onServer, task } = await setup()
    const md = put(box, "files/plan.md", "# Plan\n")
    await box.run(["artifact", "upload", task.key, md])
    const before = await onServer()
    const r = await box.run(["artifact", "edit", task.key, "plan.md"], {
      env: { ...editor(fakeEditor(box, "noop", NOOP)), ...DEBUG },
    })
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain("No changes")
    expect(sent(r.stderr, "PUT")).toBe(false)
    expect(await onServer()).toEqual(before)
  })

  test("without a terminal an inherited editor is never started (exit 2, pointing to replace)", async () => {
    const { box, text, task } = await setup()
    const md = put(box, "files/plan.md", "base")
    const up = await box.run(["artifact", "upload", task.key, md, "--json"])
    const [artifact] = up.json() as Listed[]
    const marker = join(box.root, "ran")
    const spy = fakeEditor(
      box,
      "marker",
      `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(marker)}, "ran")`,
    )
    await box.run(["config", "set", "editor", spy])
    for (const env of [{ EDITOR: spy }, { VISUAL: spy }, {}]) {
      const r = await box.run(["artifact", "edit", task.key, "plan.md"], {
        env: { ...env, ...DEBUG },
      })
      expect(r.exitCode).toBe(2)
      expect(r.stderr).toContain("intesa artifact replace")
      expect(r.stderr).toContain("INTESA_EDITOR")
      expect(sent(r.stderr, "GET")).toBe(false)
    }
    expect(existsSync(marker)).toBe(false)
    expect(await text(artifact?.id ?? "")).toBe("base")
  })

  test("which editor: INTESA_EDITOR, then config, VISUAL, EDITOR; without a terminal only the first", () => {
    const env = { INTESA_EDITOR: "mine", VISUAL: "visual", EDITOR: "editor" }
    const pick = (e: Record<string, string>, configEditor?: string, interactive = true) =>
      editorCommand({ env: e, configEditor, interactive, platform: "linux" })
    expect(pick(env, "config")).toEqual(["mine"])
    expect(pick({ VISUAL: "visual", EDITOR: "editor" }, "config")).toEqual(["config"])
    expect(pick({ VISUAL: "visual", EDITOR: "editor" })).toEqual(["visual"])
    expect(pick({ EDITOR: '"C:\\Program Files\\ed.exe" --wait' })).toEqual([
      "C:\\Program Files\\ed.exe",
      "--wait",
    ])
    expect(pick({})).toEqual(["vi"])
    expect(pick({ VISUAL: "visual" }, "config", false)).toBeUndefined()
    expect(pick({ INTESA_EDITOR: "mine" }, "config", false)).toEqual(["mine"])
  })

  test("a failing editor aborts the edit without saving", async () => {
    const { box, text, task } = await setup()
    const md = put(box, "files/plan.md", "base")
    const up = await box.run(["artifact", "upload", task.key, md, "--json"])
    const [artifact] = up.json() as Listed[]
    const r = await box.run(["artifact", "edit", task.key, "plan.md"], {
      env: { ...editor(fakeEditor(box, "fail", FAIL)), ...DEBUG },
    })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain("editor")
    expect(sent(r.stderr, "PUT")).toBe(false)
    expect(await text(artifact?.id ?? "")).toBe("base")
  })

  test("only Markdown can be edited (exit 8), without starting the editor", async () => {
    const { box, task } = await setup()
    await box.run(["artifact", "upload", task.key, fixture("brief.pdf")])
    const marker = join(box.root, "ran")
    const spy = fakeEditor(
      box,
      "marker",
      `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(marker)}, "ran")`,
    )
    const r = await box.run(["artifact", "edit", task.key, "brief.pdf"], { env: editor(spy) })
    expect(r.exitCode).toBe(8)
    expect(r.stderr).toContain("Markdown")
    expect(existsSync(marker)).toBe(false)
  })
})

describe("artifact replace", () => {
  test("replaces the content of an artifact with a file of the same name", async () => {
    const { box, text, onServer, task } = await setup()
    const original = put(box, "files/plan.md", "v1")
    const up = await box.run(["artifact", "upload", task.key, original, "--json"])
    const [artifact] = up.json() as Listed[]

    const next = put(box, "next/plan.md", "# v2\n")
    const r = await box.run(["artifact", "replace", task.key, "plan.md", next, "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ id: artifact?.id, name: "plan.md", size: 5 })
    expect(await text(artifact?.id ?? "")).toBe("# v2\n")
    expect(await onServer()).toHaveLength(1)
  })

  test("a file with another name is rejected locally (exit 8), naming both", async () => {
    const { box, text, task } = await setup()
    const original = put(box, "files/plan.md", "v1")
    const up = await box.run(["artifact", "upload", task.key, original, "--json"])
    const [artifact] = up.json() as Listed[]
    const other = put(box, "next/other.md", "v2")
    const r = await box.run(["artifact", "replace", task.key, "plan.md", other], { env: DEBUG })
    expect(r.exitCode).toBe(8)
    expect(r.stderr).toContain("plan.md")
    expect(r.stderr).toContain("other.md")
    expect(sent(r.stderr, "PUT")).toBe(false)
    expect(await text(artifact?.id ?? "")).toBe("v1")
  })

  test("only Markdown artifacts can be replaced (exit 8)", async () => {
    const { box, task } = await setup()
    await box.run(["artifact", "upload", task.key, fixture("brief.pdf")])
    const r = await box.run(["artifact", "replace", task.key, "brief.pdf", fixture("brief.pdf")], {
      env: DEBUG,
    })
    expect(r.exitCode).toBe(8)
    expect(r.stderr).toContain("Markdown")
    expect(sent(r.stderr, "PUT")).toBe(false)
  })

  test("a missing replacement file is a usage error", async () => {
    const { box, task } = await setup()
    const original = put(box, "files/plan.md", "v1")
    await box.run(["artifact", "upload", task.key, original])
    const r = await box.run(["artifact", "replace", task.key, "plan.md", "plan.md"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("plan.md")
  })
})
