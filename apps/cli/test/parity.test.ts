import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { named, nouns } from "../src/commands"
import { removeSandboxes, sandbox } from "./helpers"

// What the web app lets people do, and the commands that do it from a terminal. Every command
// must be listed here or among the CLI's own tools, so a new command is placed on purpose and
// a removed one breaks the list.
const PARITY: { web: string; cli: string[] }[] = [
  { web: "Google sign-in, two-factor check, dev login", cli: ["auth login"] },
  { web: "Sign out", cli: ["auth logout"] },
  { web: "Who is signed in (account menu)", cli: ["auth status", "me view"] },
  { web: "Profile name", cli: ["me edit"] },
  { web: "Two-factor setup and disable", cli: ["me 2fa"] },
  { web: "Settings: access tokens", cli: ["token list", "token create", "token revoke"] },
  {
    web: "Workspace list, switch and create",
    cli: ["workspace list", "workspace view", "workspace use", "workspace create"],
  },
  { web: "Workspace rename (API only)", cli: ["workspace rename"] },
  { web: "Home dashboard", cli: ["status"] },
  { web: "Weekly log, copy as Markdown", cli: ["week"] },
  { web: "My tasks, with group and completed toggles", cli: ["task list"] },
  {
    web: "Members: list, add, role, remove, leave",
    cli: ["member list", "member add", "member role", "member remove", "member leave"],
  },
  {
    web: "Projects: list, open, create",
    cli: ["project list", "project view", "project use", "project create"],
  },
  { web: "Project settings: rename, description, delete", cli: ["project edit", "project delete"] },
  { web: "Custom fields", cli: ["field list", "field create", "field edit", "field delete"] },
  {
    web: "Board columns and drag and drop",
    cli: ["task move", "task start", "task review", "task done"],
  },
  { web: "Subtask sync dialog", cli: ["task move", "task edit"] },
  { web: "Assignee filter, table sorting, search box", cli: ["task list"] },
  { web: "Create task dialog, with tag creation", cli: ["task create", "tag create"] },
  { web: "Task panel", cli: ["task view"] },
  {
    web: "Task panel: status, priority, due date, title, description",
    cli: ["task edit", "task move"],
  },
  { web: "Task panel: assignees and tags", cli: ["task edit", "task assign", "task unassign"] },
  { web: "Task panel: custom field values", cli: ["task edit"] },
  { web: "Task panel: history", cli: ["task history", "task view"] },
  { web: "Subtasks: add, edit, delete", cli: ["task create", "task edit", "task delete"] },
  { web: "Relationships: add and remove", cli: ["task link", "task unlink"] },
  { web: "Relationship picker search", cli: ["task search"] },
  {
    web: "Artifacts: list, upload, open",
    cli: ["artifact list", "artifact upload", "artifact download", "artifact view"],
  },
  { web: "Markdown artifact editor", cli: ["artifact edit", "artifact replace"] },
  { web: "Context menu: open, copy link, copy ID", cli: ["task open", "task url", "task view"] },
  { web: "Delete task", cli: ["task delete"] },
  {
    web: "Tags: list, rename, recolor, delete (API only)",
    cli: ["tag list", "tag edit", "tag delete"],
  },
]

// Terminal tools with no web counterpart, by noun or full command.
const CLI_ONLY = ["api", "schema", "completion", "config", "board", "mcp", "auth token"]

type Schema = { commands: { command: string; path: string[]; examples: string[] }[] }
let schema: Schema

beforeAll(async () => {
  const r = await sandbox().run(["schema"])
  expect(r.exitCode, r.stderr).toBe(0)
  schema = r.json()
})
afterAll(removeSandboxes)

const pathOf = (c: { path: string[] }) => c.path.join(" ")
const listed = [...new Set(PARITY.flatMap((row) => row.cli))]

describe("web parity", () => {
  test.each(listed)("intesa %s exists and has an example", (path) => {
    const command = schema.commands.find((c) => pathOf(c) === path)
    expect(command, `intesa ${path} is not a command`).toBeDefined()
    // An example must at least use the command's noun, under its name or an alias.
    const [noun = ""] = path.split(" ")
    const spellings = [noun, ...(nouns.find(named(noun))?.aliases ?? [])]
    const relevant = (command?.examples ?? []).filter((e) =>
      spellings.some((s) => `${e} `.startsWith(`intesa ${s} `)),
    )
    expect(relevant.length, `intesa ${path} has no example`).toBeGreaterThan(0)
  })

  test("every command is matched to a web feature or is a CLI-only tool", () => {
    const cliOnly = (path: string) => CLI_ONLY.some((p) => path === p || path.startsWith(`${p} `))
    const unplaced = schema.commands
      .map(pathOf)
      .filter((path) => !listed.includes(path) && !cliOnly(path))
    expect(unplaced).toEqual([])
  })

  test("the CLI-only tools exist", () => {
    const paths = schema.commands.map(pathOf)
    for (const tool of CLI_ONLY) {
      expect(
        paths.some((p) => p === tool || p.startsWith(`${tool} `)),
        tool,
      ).toBe(true)
    }
  })
})
