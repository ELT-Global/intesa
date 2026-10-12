import { styleText } from "node:util"
import { project, toJson } from "./json"
import type { Mode } from "./mode"
import { formatTable, timestampText } from "./table"

const TASK = [
  "id",
  "key",
  "number",
  "projectId",
  "parentTaskId",
  "title",
  "body",
  "status",
  "priority",
  "dueAt",
  "assignees",
  "tags",
  "subtaskCount",
  "subtaskDoneCount",
  "createdAt",
  "updatedAt",
  "url",
] as const
const TASK_COLUMNS = ["key", "status", "priority", "title", "assignees", "tags", "dueAt"] as const
const TOKEN = ["id", "name", "kind", "scope", "lastFour", "createdAt", "lastUsedAt", "expiresAt"]
const ACCOUNT = ["id", "name", "email", "avatarUrl", "totpEnabled"] as const
const PROJECT = ["id", "key", "name", "description", "workspaceId", "createdAt", "updatedAt", "url"]
const ARTIFACT = ["id", "name", "mimeType", "size", "createdAt", "updatedAt", "url"] as const

type FieldSet = {
  // What --fields and `intesa schema` accept. JSON names are the API's own (camelCase).
  fields: readonly string[]
  // The default table; all fields when left out.
  columns?: readonly string[]
  // What -q prints of each row; the key, else the id, when left out.
  quiet?: string
}

// Named output shapes.
export const FIELD_SETS = {
  config: { fields: ["key", "value"] },
  apiToken: { fields: [...TOKEN, "current"] },
  // `token create`: the list shape plus the plaintext, which the server shows only once.
  newApiToken: { fields: ["token", ...TOKEN], columns: ["token"], quiet: "token" },
  // `auth token`.
  authToken: { fields: ["token"], quiet: "token" },
  account: { fields: ACCOUNT },
  // `me 2fa`: the account after disable, or where to enable it in the web app.
  twoFactor: { fields: [...ACCOUNT, "url"], columns: ["email", "totpEnabled"] },
  authStatus: {
    fields: [
      "host",
      "user",
      "name",
      "userId",
      "tokenId",
      "tokenName",
      "kind",
      "scope",
      "expiresAt",
      "lastUsedAt",
      "storage",
      "totpEnabled",
    ],
    columns: ["host", "user", "kind", "scope", "expiresAt", "storage", "totpEnabled"],
  },
  // `url` is the web app link for the item. Slugs are what other commands take.
  workspace: {
    fields: ["id", "name", "slug", "role", "url"],
    columns: ["slug", "name", "role"],
    quiet: "slug",
  },
  project: { fields: PROJECT, columns: ["key", "name", "description"] },
  // `project view`: also top-level task counts per status and the custom field definitions.
  projectView: {
    fields: [...PROJECT, "taskCounts", "customFields"],
    columns: ["key", "name", "description", "taskCounts"],
  },
  // `use`: what became the default, and the file it was written to.
  workspaceDefault: { fields: ["id", "slug", "file"], quiet: "slug" },
  projectDefault: { fields: ["id", "key", "file"] },
  // Task summaries as the API returns them, plus `url`.
  task: { fields: TASK, columns: TASK_COLUMNS },
  // `task view`: the API's task detail, plus `url`, the artifacts and (--history) history.
  taskDetail: {
    fields: [
      ...TASK,
      "project",
      "parent",
      "subtasks",
      "blockedBy",
      "blocks",
      "related",
      "customFields",
      "artifacts",
      "history",
    ],
    columns: ["key", "status", "title"],
  },
  // `task move` and its shorthands: also the subtasks left in another status.
  taskMove: { fields: [...TASK, "subtasksOutOfSync"], columns: TASK_COLUMNS },
  member: {
    fields: ["id", "userId", "name", "email", "avatarUrl", "role", "createdAt"],
    columns: ["name", "email", "role"],
  },
  tag: { fields: ["id", "name", "color"] },
  field: {
    fields: ["id", "projectId", "name", "type", "required", "options", "position"],
    columns: ["id", "name", "type", "required", "options"],
  },
  // `status`: the Home page's sections; each task carries its `key` and `url`.
  status: { fields: ["projects", "assigned", "dueSoon"] },
  // `week`: the Monday of the week, its bounds as ISO instants, then each person with their tasks;
  // every task carries its `url`.
  week: { fields: ["week", "from", "to", "people"] },
  // `url` is the artifact's own address under /api; a browser needs a web session to open it.
  artifact: { fields: ARTIFACT, columns: ["id", "name", "mimeType", "size", "updatedAt"] },
  // `artifact view`: also the text, for Markdown.
  artifactView: {
    fields: [...ARTIFACT, "content"],
    columns: ["id", "name", "mimeType", "size", "updatedAt", "content"],
  },
  // `artifact download`: also where the file went.
  artifactDownload: {
    fields: [...ARTIFACT, "path"],
    columns: ["id", "name", "mimeType", "size", "path"],
  },
  // What a delete, removal or revocation reports: the id, what people call it, `deleted: true`.
  deleted: { fields: ["id", "key", "name", "email", "deleted"] },
  // `task search`: the API's short task references, matched by title or key.
  taskRef: { fields: ["id", "key", "title", "status"], columns: ["key", "status", "title"] },
  // `task history`: status changes, oldest first.
  taskHistory: {
    fields: ["id", "fromStatus", "toStatus", "updatedAt", "updatedBy"],
    columns: ["updatedAt", "updatedBy", "fromStatus", "toStatus"],
  },
  // `task url` and `task open`: the task's web link.
  taskLink: { fields: ["id", "key", "url"], quiet: "url" },
} as const satisfies Record<string, FieldSet>

export type OutputName = keyof typeof FIELD_SETS

type Row = Record<string, unknown>

// Detail views (`task view`, `project view`, `status`) are titled sections, like the web's
// panels: a bold title where there is color, then rows without a header.
export const section = (mode: Mode, title: string, body: string) =>
  `${mode.color ? styleText("bold", title) : title}
${body}`
export const rows = (mode: Mode, items: Row[], columns: string[]) =>
  formatTable(items, columns, { tty: mode.tty, width: mode.width, header: false })

const isRow = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v)

// The default table, for a command's own format to fall back on.
export const asTable = (mode: Mode, data: unknown, output?: OutputName) =>
  render(data, { output, json: false, quiet: false, mode })

export function render(
  data: unknown,
  opts: { output?: OutputName; fields?: string[]; json: boolean; quiet: boolean; mode: Mode },
): string {
  if (opts.json) return toJson(project(data, opts.fields))
  const set: FieldSet | undefined = opts.output && FIELD_SETS[opts.output]
  if (opts.quiet) {
    // The identifier people pipe into the next command.
    const idOf = (row: unknown) =>
      isRow(row) ? (set?.quiet ? row[set.quiet] : (row.key ?? row.id)) : undefined
    const ids = (Array.isArray(data) ? data : [data]).map(idOf).filter((id) => id !== undefined)
    return ids.map((id) => `${id}\n`).join("")
  }
  const table = { tty: opts.mode.tty, width: opts.mode.width, color: opts.mode.color }
  if (Array.isArray(data)) {
    const rows = data.filter(isRow)
    const columns = opts.fields ?? [
      ...(set ? (set.columns ?? set.fields) : Object.keys(rows[0] ?? {})),
    ]
    return formatTable(rows, columns, table)
  }
  if (isRow(data)) {
    const keys = opts.fields ?? Object.keys(data)
    const rows = keys.map((field) => ({
      field,
      value: opts.mode.tty ? (timestampText(field, data[field]) ?? data[field]) : data[field],
    }))
    return formatTable(rows, ["field", "value"], { ...table, header: false })
  }
  return data === undefined ? "" : `${String(data)}\n`
}
