import { project, toJson } from "./json"
import type { Mode } from "./mode"
import { formatTable } from "./table"

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
  // `me 2fa`: the account after enable/disable, or the enrolment details after setup.
  twoFactor: {
    fields: ["id", "name", "email", "avatarUrl", "totpEnabled", "secret", "otpauthUrl"],
    columns: ["secret", "otpauthUrl"],
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
  // `status`: the Home page's sections; each task carries its `key` and `url`.
  status: {
    fields: ["projects", "assigned", "dueSoon"],
    columns: ["projects", "assigned", "dueSoon"],
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
