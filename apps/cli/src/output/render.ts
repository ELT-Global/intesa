import { project, toJson } from "./json"
import type { Mode } from "./mode"
import { formatTable } from "./table"

const TASK_FIELDS = [
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

// Named output shapes. `fields` is what --fields and `intesa schema` accept; `columns` is the
// default table. JSON names are the API's own (camelCase).
export const FIELD_SETS = {
  config: { fields: ["key", "value"], columns: ["key", "value"] },
  apiToken: {
    fields: [
      "id",
      "name",
      "kind",
      "scope",
      "lastFour",
      "createdAt",
      "lastUsedAt",
      "expiresAt",
      "current",
    ],
    columns: [
      "id",
      "name",
      "kind",
      "scope",
      "lastFour",
      "createdAt",
      "lastUsedAt",
      "expiresAt",
      "current",
    ],
  },
  account: {
    fields: ["id", "name", "email", "avatarUrl", "totpEnabled"],
    columns: ["id", "name", "email", "avatarUrl", "totpEnabled"],
  },
  // `token create`: the list shape plus the plaintext, which the server shows only once.
  newApiToken: {
    fields: [
      "token",
      "id",
      "name",
      "kind",
      "scope",
      "lastFour",
      "createdAt",
      "lastUsedAt",
      "expiresAt",
    ],
    columns: ["token"],
  },
  // `me 2fa`: the account after disable, or where to enable it in the web app.
  twoFactor: {
    fields: ["id", "name", "email", "avatarUrl", "totpEnabled", "url"],
    columns: ["email", "totpEnabled"],
  },
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
  // `url` is the web app link for the item.
  workspace: {
    fields: ["id", "name", "slug", "role", "url"],
    columns: ["slug", "name", "role"],
  },
  project: {
    fields: ["id", "key", "name", "description", "workspaceId", "createdAt", "updatedAt", "url"],
    columns: ["key", "name", "description"],
  },
  // `project view`: also top-level task counts per status and the custom field definitions.
  projectView: {
    fields: [
      "id",
      "key",
      "name",
      "description",
      "workspaceId",
      "createdAt",
      "updatedAt",
      "url",
      "taskCounts",
      "customFields",
    ],
    columns: ["key", "name", "description", "taskCounts"],
  },
  // Task summaries as the API returns them, plus `url`. Piped tables show people and tags
  // as names.
  task: {
    fields: TASK_FIELDS,
    columns: ["key", "status", "priority", "title", "assignees", "tags", "dueAt"],
  },
  // `task view`: the API's task detail, plus `url`, the artifacts and (--history) history.
  taskDetail: {
    fields: [
      ...TASK_FIELDS,
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
  taskMove: {
    fields: [...TASK_FIELDS, "subtasksOutOfSync"],
    columns: ["key", "status", "priority", "title", "assignees", "tags", "dueAt"],
  },
  member: {
    fields: ["id", "userId", "name", "email", "avatarUrl", "role", "createdAt"],
    columns: ["name", "email", "role"],
  },
  tag: { fields: ["id", "name", "color"], columns: ["id", "name", "color"] },
  field: {
    fields: ["id", "projectId", "name", "type", "required", "options", "position"],
    columns: ["id", "name", "type", "required", "options"],
  },
  // `status`: the Home page's sections; each task carries its `key` and `url`.
  status: {
    fields: ["projects", "assigned", "dueSoon"],
    columns: ["projects", "assigned", "dueSoon"],
  },
  // `url` is the artifact's own address under /api; a browser needs a web session to open it.
  artifact: {
    fields: ["id", "name", "mimeType", "size", "createdAt", "updatedAt", "url"],
    columns: ["id", "name", "mimeType", "size", "updatedAt"],
  },
  // `artifact view`: also the text, for Markdown.
  artifactView: {
    fields: ["id", "name", "mimeType", "size", "createdAt", "updatedAt", "url", "content"],
    columns: ["id", "name", "mimeType", "size", "updatedAt", "content"],
  },
  // `artifact download`: also where the file went.
  artifactDownload: {
    fields: ["id", "name", "mimeType", "size", "createdAt", "updatedAt", "url", "path"],
    columns: ["id", "name", "mimeType", "size", "path"],
  },
} as const satisfies Record<string, { fields: readonly string[]; columns: readonly string[] }>

export type OutputName = keyof typeof FIELD_SETS

type Row = Record<string, unknown>
const isRow = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v)

// What `-q` prints: the identifier people pipe into the next command.
const idOf = (row: unknown) => (isRow(row) ? (row.key ?? row.id) : undefined)

export function render(
  data: unknown,
  opts: { output?: OutputName; fields?: string[]; json: boolean; quiet: boolean; mode: Mode },
): string {
  if (opts.json) return toJson(project(data, opts.fields))
  if (opts.quiet) {
    const ids = (Array.isArray(data) ? data : [data]).map(idOf).filter((id) => id !== undefined)
    return ids.map((id) => `${id}\n`).join("")
  }
  const table = { tty: opts.mode.tty, width: opts.mode.width, color: opts.mode.color }
  if (Array.isArray(data)) {
    const rows = data.filter(isRow)
    const set = opts.output && FIELD_SETS[opts.output]
    const columns = opts.fields ?? (set ? [...set.columns] : Object.keys(rows[0] ?? {}))
    return formatTable(rows, columns, table)
  }
  if (isRow(data)) {
    const keys = opts.fields ?? Object.keys(data)
    const rows = keys.map((field) => ({ field, value: data[field] }))
    return formatTable(rows, ["field", "value"], { ...table, header: false })
  }
  return data === undefined ? "" : `${String(data)}\n`
}
