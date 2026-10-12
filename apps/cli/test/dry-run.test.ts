import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { TOOL_KINDS } from "../src/mcp/tools"
import {
  type RunOptions,
  removeSandboxes,
  startServer,
  type TestServer,
  type World,
  world,
} from "./helpers"

// Every command of `intesa schema` is either a read or a mutation. Each mutation, run with
// --dry-run, prints the one request it would have made first (a file it would have written
// shows as method WRITE) and changes nothing: not the server, not the config.

const READS = [
  "intesa auth status",
  "intesa auth token",
  "intesa workspace list",
  "intesa workspace view",
  "intesa project list",
  "intesa project view",
  "intesa task list",
  "intesa task view",
  "intesa task history",
  "intesa task search",
  "intesa task open",
  "intesa task url",
  "intesa board",
  "intesa member list",
  "intesa tag list",
  "intesa field list",
  "intesa artifact list",
  "intesa artifact download",
  "intesa artifact view",
  "intesa status",
  "intesa week",
  "intesa config get",
  "intesa config list",
  "intesa schema",
  "intesa token list",
  "intesa me view",
  "intesa completion",
  "intesa mcp",
]

type Expected = {
  args: string[]
  method: string
  // Exact for requests; for WRITE, the end of the file's path.
  path: string
  body?: Record<string, unknown>
  env?: RunOptions["env"]
}

let server: TestServer
let w: World
let mutations: Record<string, Expected>

beforeAll(async () => {
  server = await startServer()
  w = await world(server)
  const { workspace, project, me, session, box } = w
  const mei = await w.addPerson("Mei Member")
  const members = (await session.call("GET", `/api/workspaces/${workspace.id}/members`)).body
    .members as { id: string; userId: string }[]
  const memberId = (userId: string) => members.find((m) => m.userId === userId)?.id
  const tag = await w.addTag("bug")
  const field = await w.addField({ name: "Estimate", type: "number" })
  const parent = await w.addTask({ title: "Parent" })
  await w.addTask({ title: "Kid", parentTaskId: parent.id })
  const other = await w.addTask({ title: "Other" })
  await session.call("POST", `/api/tasks/${parent.id}/relationships`, {
    type: "blocks",
    taskId: other.id,
  })

  const notes = join(box.root, "files", "notes.md")
  mkdirSync(join(box.root, "files"), { recursive: true })
  writeFileSync(notes, "# Notes\n")
  const form = new FormData()
  form.append("file", new File(["# Old\n"], "notes.md"))
  const upload = await session.request(`/api/tasks/${parent.id}/artifacts`, {
    method: "POST",
    body: form,
  })
  const { artifact } = (await upload.json()) as { artifact: { id: string } }
  const editor = join(box.root, "editor.ts")
  writeFileSync(
    editor,
    `import { appendFileSync } from "node:fs"\nappendFileSync(process.argv[2], "edited\\n")`,
  )

  const task = `/api/tasks/${parent.id}`
  const members_ = `/api/workspaces/${workspace.id}/members`
  mutations = {
    "intesa auth login": {
      args: ["auth", "login", "--dev", "--email", "dry-login@example.com"],
      method: "POST",
      path: "/api/auth/dev-login",
      body: { email: "dry-login@example.com" },
    },
    "intesa auth logout": {
      args: ["auth", "logout"],
      method: "DELETE",
      path: "/api/me/tokens/current",
    },
    "intesa workspace create": {
      args: ["ws", "create", "Dry", "--slug", `dry-${w.id}`],
      method: "POST",
      path: "/api/workspaces",
      body: { name: "Dry", slug: `dry-${w.id}` },
    },
    "intesa workspace rename": {
      args: ["ws", "rename", "Renamed"],
      method: "PATCH",
      path: `/api/workspaces/${workspace.id}`,
      body: { name: "Renamed" },
    },
    "intesa workspace use": {
      args: ["ws", "use", workspace.slug],
      method: "WRITE",
      path: "config.json",
      body: { workspace: workspace.slug },
    },
    "intesa project create": {
      args: ["p", "create", "Dry", "--key", "dry"],
      method: "POST",
      path: `/api/workspaces/${workspace.id}/projects`,
      body: { name: "Dry", key: "DRY" },
    },
    "intesa project edit": {
      args: ["p", "edit", "WEB", "--no-description"],
      method: "PATCH",
      path: `/api/projects/${project.id}`,
      body: { description: null },
    },
    "intesa project delete": {
      args: ["p", "delete", "WEB"],
      method: "DELETE",
      path: `/api/projects/${project.id}`,
    },
    "intesa project use": {
      args: ["p", "use", "web", "--local"],
      method: "WRITE",
      path: ".intesa.json",
      body: { project: "WEB" },
    },
    "intesa task create": {
      args: ["task", "create", "-p", "WEB", "-T", "Dry", "-a", "@me", "--field", "Estimate=3"],
      method: "POST",
      path: `/api/projects/${project.id}/tasks`,
      body: { title: "Dry", assigneeIds: [me], customFields: { [field.id]: 3 } },
    },
    "intesa task edit": {
      args: ["task", "edit", parent.key, "--add-assignee", "Mei Member", "--no-due"],
      method: "PATCH",
      path: task,
      body: { dueAt: null, assigneeIds: [mei.id] },
    },
    // Only the parent's request: its subtasks would follow it.
    "intesa task move": {
      args: ["task", "move", parent.key, "complete", "--subtasks", "match", "--top"],
      method: "PATCH",
      path: task,
      body: { status: "complete", placement: "first" },
    },
    "intesa task start": {
      args: ["task", "start", parent.key],
      method: "PATCH",
      path: task,
      body: { status: "in_progress" },
    },
    "intesa task review": {
      args: ["task", "review", parent.key],
      method: "PATCH",
      path: task,
      body: { status: "review" },
    },
    "intesa task done": {
      args: ["task", "done", parent.key],
      method: "PATCH",
      path: task,
      body: { status: "complete" },
    },
    "intesa task assign": {
      args: ["task", "assign", parent.key],
      method: "PATCH",
      path: task,
      body: { assigneeIds: [me] },
    },
    "intesa task unassign": {
      args: ["task", "unassign", parent.key, "mei member"],
      method: "PATCH",
      path: task,
      body: { assigneeIds: [] },
    },
    "intesa task delete": { args: ["task", "delete", parent.key], method: "DELETE", path: task },
    "intesa task link": {
      args: ["task", "link", parent.key, "--related", other.key],
      method: "POST",
      path: `${task}/relationships`,
      body: { type: "related", taskId: other.id },
    },
    // Unlinked from the other side: the link is found, then removed.
    "intesa task unlink": {
      args: ["task", "unlink", other.key, parent.key],
      method: "DELETE",
      path: `/api/tasks/${other.id}/relationships/${parent.id}?type=blocked_by`,
    },
    "intesa member add": {
      args: ["member", "add", "new@example.com", "--role", "owner"],
      method: "POST",
      path: members_,
      body: { email: "new@example.com", role: "owner" },
    },
    "intesa member role": {
      args: ["member", "role", mei.email, "owner"],
      method: "PATCH",
      path: `${members_}/${memberId(mei.id)}`,
      body: { role: "owner" },
    },
    "intesa member remove": {
      args: ["member", "remove", "Mei Member"],
      method: "DELETE",
      path: `${members_}/${memberId(mei.id)}`,
    },
    "intesa member leave": {
      args: ["member", "leave"],
      method: "DELETE",
      path: `${members_}/${memberId(me)}`,
    },
    "intesa tag create": {
      args: ["tag", "create", "Plain"],
      method: "POST",
      path: `/api/workspaces/${workspace.id}/tags`,
      body: { name: "Plain" },
    },
    "intesa tag edit": {
      args: ["tag", "edit", "BUG", "--color", "gray"],
      method: "PATCH",
      path: `/api/tags/${tag.id}`,
      body: { color: "gray" },
    },
    "intesa tag delete": {
      args: ["tag", "delete", "bug"],
      method: "DELETE",
      path: `/api/tags/${tag.id}`,
    },
    "intesa field create": {
      args: [
        "field",
        "create",
        "Stage",
        "-p",
        "WEB",
        "--type",
        "select",
        "--option",
        "A",
        "--required",
      ],
      method: "POST",
      path: `/api/projects/${project.id}/custom-fields`,
      body: { name: "Stage", type: "select", required: true, options: ["A"] },
    },
    "intesa field edit": {
      args: ["field", "edit", "estimate", "-p", "WEB", "--name", "Points"],
      method: "PATCH",
      path: `/api/custom-fields/${field.id}`,
      body: { name: "Points" },
    },
    "intesa field delete": {
      args: ["field", "delete", "Estimate", "-p", "WEB"],
      method: "DELETE",
      path: `/api/custom-fields/${field.id}`,
    },
    "intesa artifact upload": {
      args: ["artifact", "upload", parent.key, notes],
      method: "POST",
      path: `${task}/artifacts`,
      body: { file: { name: "notes.md", size: 8 } },
    },
    "intesa artifact edit": {
      args: ["artifact", "edit", parent.key, "notes.md"],
      method: "PUT",
      path: `${task}/artifacts/${artifact.id}`,
      env: { INTESA_EDITOR: `"${process.execPath}" "${editor}"` },
    },
    "intesa artifact replace": {
      args: ["artifact", "replace", parent.key, "notes.md", notes],
      method: "PUT",
      path: `${task}/artifacts/${artifact.id}`,
    },
    "intesa api": {
      args: ["api", "/auth/dev-login", "-f", "email=api-dry@example.com"],
      method: "POST",
      path: "/api/auth/dev-login",
      body: { email: "api-dry@example.com" },
    },
    "intesa config set": {
      args: ["config", "set", "editor", "vim -f"],
      method: "WRITE",
      path: "config.json",
      body: { editor: "vim -f" },
    },
    "intesa token create": {
      args: ["token", "create", "--name", "dry", "--scope", "read", "--expires", "90d"],
      method: "POST",
      path: "/api/me/tokens",
      body: { name: "dry", scope: "read", expiresInDays: 90 },
    },
    "intesa token revoke": {
      args: ["token", "revoke", w.tokenId],
      method: "DELETE",
      path: `/api/me/tokens/${w.tokenId}`,
    },
    "intesa me edit": {
      args: ["me", "edit", "--name", "Dry Run"],
      method: "PATCH",
      path: "/api/me",
      body: { name: "Dry Run" },
    },
    "intesa me 2fa": {
      args: ["me", "2fa", "disable", "--code", "123456"],
      method: "POST",
      path: "/api/me/2fa/disable",
      body: { code: "123456" },
    },
  }
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

const TABLES = [
  "users",
  "workspaces",
  "workspaceMembers",
  "projects",
  "tasks",
  "taskAssignees",
  "tags",
  "taskTags",
  "taskStatusHistory",
  "taskRelationships",
  "customFieldDefinitions",
  "taskCustomFieldValues",
  "artifacts",
  "apiTokens",
  "sessions",
] as const

// Everything a mutation could change. Reads touch a token's lastUsedAt and the cached
// workspace in hosts.json, which are bookkeeping rather than changes.
async function state() {
  const db: Record<string, unknown> = {}
  for (const table of TABLES) {
    const rows = (await server.db
      .selectFrom(table as "users")
      .selectAll()
      .execute()) as Record<string, unknown>[]
    db[table] = rows.map(({ lastUsedAt: _, ...row }) => row)
  }
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null)
  const hosts = JSON.parse(read(join(w.box.configDir, "hosts.json")) ?? "{}")
  for (const entry of Object.values(hosts)) delete (entry as { workspace?: unknown }).workspace
  return {
    db,
    hosts,
    config: read(join(w.box.configDir, "config.json")),
    local: read(join(w.box.root, "work", ".intesa.json")),
  }
}

describe("--dry-run", () => {
  test("every command is a read or a mutation", async () => {
    const schema = (await w.box.run(["schema"])).json()
    const commands: string[] = schema.commands.map((c: { command: string }) => c.command)
    const mutating = Object.keys(mutations)
    expect(commands.filter((c) => !READS.includes(c) && !mutating.includes(c))).toEqual([])
    expect(mutating.filter((c) => !commands.includes(c))).toEqual([])
  })

  // `intesa mcp` tells agents its read tools change nothing.
  test("every read-only MCP tool is a read", () => {
    const mcpReads = Object.entries(TOOL_KINDS)
      .filter(([, kind]) => kind === "read")
      .map(([command]) => `intesa ${command}`)
    expect(mcpReads.filter((c) => !READS.includes(c))).toEqual([])
  })

  // test.each needs its table before the world exists, so the names are listed here.
  const names = [
    "intesa auth login",
    "intesa auth logout",
    "intesa workspace create",
    "intesa workspace rename",
    "intesa workspace use",
    "intesa project create",
    "intesa project edit",
    "intesa project delete",
    "intesa project use",
    "intesa task create",
    "intesa task edit",
    "intesa task move",
    "intesa task start",
    "intesa task review",
    "intesa task done",
    "intesa task assign",
    "intesa task unassign",
    "intesa task delete",
    "intesa task link",
    "intesa task unlink",
    "intesa member add",
    "intesa member role",
    "intesa member remove",
    "intesa member leave",
    "intesa tag create",
    "intesa tag edit",
    "intesa tag delete",
    "intesa field create",
    "intesa field edit",
    "intesa field delete",
    "intesa artifact upload",
    "intesa artifact edit",
    "intesa artifact replace",
    "intesa api",
    "intesa config set",
    "intesa token create",
    "intesa token revoke",
    "intesa me edit",
    "intesa me 2fa",
  ]

  test("lists every mutation", () => {
    expect([...names].sort()).toEqual(Object.keys(mutations).sort())
  })

  test.each(names)("%s prints one request and changes nothing", async (name) => {
    const expected = mutations[name]
    if (!expected) throw new Error(`no dry run for ${name}`)
    const before = await state()
    const r = await w.box.run([...expected.args, "--dry-run"], { env: expected.env })
    expect(r.exitCode, r.stderr).toBe(0)
    const printed = r.json()
    expect(Object.keys(printed).sort()).toEqual(["body", "method", "path"])
    expect(printed.method).toBe(expected.method)
    if (expected.method === "WRITE") expect(printed.path).toEndWith(expected.path)
    else expect(printed.path).toBe(expected.path)
    if (expected.body !== undefined) expect(printed.body).toMatchObject(expected.body)
    expect(await state()).toEqual(before)
  })
})
