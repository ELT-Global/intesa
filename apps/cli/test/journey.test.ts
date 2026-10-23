import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { clientWithToken, userId } from "../../api/test/helpers"
import { loginAs, removeSandboxes, sandbox, startServer, type TestServer } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

const BRIEF = resolve(import.meta.dir, "../../../e2e/fixtures/artifacts/brief.pdf")

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

// One person's first session with the CLI, start to finish: a workspace and a project that are
// remembered in the repository, a task with subtasks, moving it through the board, an
// artifact, searching, deleting, and finally signing out. Every command runs inside the repo
// directory and none passes -w or -p: the context comes from .intesa.json alone.
test("a journey from an empty account to a finished task and back to signed out", async () => {
  const email = "journey@example.com"
  const box = sandbox(server.url)
  const { token } = await loginAs(box, server, email)
  const me = await userId(server, email)

  const repo = join(box.root, "repo")
  mkdirSync(repo, { recursive: true })
  const run = (args: string[], opts: { stdin?: string } = {}) =>
    box.run(args, { cwd: repo, ...opts })
  const localFile = () => JSON.parse(readFileSync(join(repo, ".intesa.json"), "utf8"))

  // Workspace and project, remembered in the repository.
  const ws = await run(["ws", "create", "Acme Corp", "--slug", "acme", "--json"])
  expect(ws.exitCode).toBe(0)
  expect(ws.json()).toMatchObject({ name: "Acme Corp", slug: "acme", role: "owner" })

  const useWs = await run(["ws", "use", "acme", "--local"])
  expect(useWs.exitCode).toBe(0)
  expect(localFile()).toEqual({ workspace: "acme" })

  const created = await run([
    "project",
    "create",
    "Website",
    "--key",
    "WEB",
    "--description",
    "The marketing site",
    "--json",
  ])
  expect(created.exitCode).toBe(0)
  expect(created.json()).toMatchObject({
    key: "WEB",
    name: "Website",
    description: "The marketing site",
  })

  const useProject = await run(["p", "use", "WEB", "--local"])
  expect(useProject.exitCode).toBe(0)
  expect(localFile()).toEqual({ workspace: "acme", project: "WEB" })

  // A task with every kind of detail, creating its tags on the way.
  const due = inDays(2)
  const parent = await run([
    "task",
    "create",
    "-T",
    "Fix login redirect",
    "--priority",
    "high",
    "--due",
    due,
    "-a",
    "@me",
    "-t",
    "auth,bug",
    "--create-tags",
    "-b",
    "Users land on the home page after signing in.",
    "--json",
  ])
  expect(parent.exitCode).toBe(0)
  expect(parent.stderr).toContain("Created tag auth")
  expect(parent.stderr).toContain("Created tag bug")
  expect(parent.json()).toMatchObject({
    key: "WEB-1",
    title: "Fix login redirect",
    body: "Users land on the home page after signing in.",
    status: "todo",
    priority: "high",
    dueAt: due,
    parentTaskId: null,
  })
  expect(parent.json().assignees.map((a: { id: string }) => a.id)).toEqual([me])
  expect(parent.json().tags.map((t: { name: string }) => t.name)).toEqual(["auth", "bug"])

  // Two subtasks, which the board listing leaves out.
  for (const [i, title] of ["Reproduce the bug", "Write a regression test"].entries()) {
    const sub = await run(["task", "create", "--parent", "WEB-1", "-T", title, "--json"])
    expect(sub.exitCode).toBe(0)
    expect(sub.json()).toMatchObject({
      key: `WEB-${i + 2}`,
      title,
      parentTaskId: parent.json().id,
    })
  }
  const topLevel = await run(["task", "list", "--json", "--fields", "key,title,status"])
  expect(topLevel.exitCode).toBe(0)
  expect(topLevel.json()).toEqual([{ key: "WEB-1", title: "Fix login redirect", status: "todo" }])

  // Moving the parent can bring its subtasks along.
  const moved = await run(["task", "move", "web-1", "review", "--subtasks", "match", "--json"])
  expect(moved.exitCode).toBe(0)
  expect(moved.json()).toMatchObject({ key: "WEB-1", status: "review", subtasksOutOfSync: [] })
  const viewed = await run(["task", "view", "WEB-1", "--json"])
  expect(viewed.exitCode).toBe(0)
  const subtasks = viewed.json().subtasks as { key: string; status: string }[]
  expect(subtasks.map((s) => [s.key, s.status]).sort()).toEqual([
    ["WEB-2", "review"],
    ["WEB-3", "review"],
  ])

  // Completing it needs to know who reviewed and tested it. Without --subtasks the subtasks
  // are left behind, and it says so.
  const done = await run([
    "task",
    "done",
    "WEB-1",
    "--reviewed-by",
    "@me",
    "--tested-by",
    "none",
    "--json",
  ])
  expect(done.exitCode, done.stderr).toBe(0)
  expect(done.json()).toMatchObject({ key: "WEB-1", status: "complete" })
  const signed = await run(["task", "view", "WEB-1", "--json", "--fields", "reviewedBy,testedBy"])
  expect(signed.json()).toEqual({ reviewedBy: expect.objectContaining({ id: me }), testedBy: null })
  const outOfSync = done.json().subtasksOutOfSync as { key: string; status: string }[]
  expect(outOfSync.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
    { key: "WEB-2", status: "review" },
    { key: "WEB-3", status: "review" },
  ])

  // An artifact comes back byte for byte.
  const notes = "# Notes\n\nThe redirect drops the `next` parameter.\n"
  writeFileSync(join(repo, "notes.md"), notes)
  const upload = await run(["artifact", "upload", "WEB-1", "notes.md", BRIEF, "--json"])
  expect(upload.exitCode).toBe(0)
  expect(upload.json().map((a: { name: string }) => a.name)).toEqual(["notes.md", "brief.pdf"])
  const text = await run(["artifact", "download", "WEB-1", "notes.md", "-o", "-"])
  expect(text.exitCode).toBe(0)
  expect(text.stdoutBytes).toEqual(new Uint8Array(Buffer.from(notes)))
  const pdf = await run(["artifact", "download", "WEB-1", "brief.pdf", "-o", "-"])
  expect(pdf.exitCode).toBe(0)
  expect(pdf.stdoutBytes).toEqual(new Uint8Array(readFileSync(BRIEF)))

  // Searching: completed work only shows when asked for.
  const query = "priority:high has:due"
  const hidden = await run(["task", "list", "-Q", query, "-q"])
  expect(hidden.exitCode).toBe(0)
  expect(hidden.stdout).toBe("")
  const found = await run(["task", "list", "-Q", query, "--include-complete", "-q"])
  expect(found.exitCode).toBe(0)
  expect(found.stdout).toBe("WEB-1\n")

  // Deleting needs consent when there is no terminal to ask on.
  const refused = await run(["task", "delete", "WEB-2"])
  expect(refused.exitCode).toBe(2)
  expect(refused.stderr).toContain("--yes")
  expect((await run(["task", "view", "WEB-2", "--json"])).exitCode).toBe(0)
  const deleted = await run(["task", "delete", "WEB-2", "--yes"])
  expect(deleted.exitCode).toBe(0)
  expect((await run(["task", "view", "WEB-2"])).exitCode).toBe(5)

  // Mistakes: a missing task, in prose and as the --json error envelope, and a bad field name.
  const missing = await run(["task", "view", "WEB-99"])
  expect(missing.exitCode).toBe(5)
  expect(missing.stderr).toStartWith("error: ")
  const missingJson = await run(["task", "view", "WEB-99", "--json"])
  expect(missingJson.exitCode).toBe(5)
  expect(missingJson.stdout).toBe("")
  expect(JSON.parse(missingJson.stderr.trim().split("\n").at(-1) ?? "")).toMatchObject({
    error: { code: "NOT_FOUND", exitCode: 5 },
  })
  const badFields = await run(["task", "list", "--fields", "nope"])
  expect(badFields.exitCode).toBe(2)
  expect(badFields.stderr).toContain("nope")

  // Signing out revokes the token on the server and forgets it here.
  const stored = await run(["auth", "token"])
  expect(stored.stdout.trim()).toBe(token)
  const api = clientWithToken(server.app, token)
  expect((await api.call("GET", "/api/me")).status).toBe(200)
  expect((await run(["auth", "logout"])).exitCode).toBe(0)
  expect((await api.call("GET", "/api/me")).status).toBe(401)
  expect((await run(["auth", "status"])).exitCode).toBe(4)
}, 180_000)
