import { project, toJson } from "./json"
import type { Mode } from "./mode"
import { formatTable } from "./table"

// Named output shapes. `fields` is what --fields and `intesa schema` accept; `columns` is the
// default table. JSON names are the API's own (camelCase).
export const FIELD_SETS = {
  config: { fields: ["key", "value"], columns: ["key", "value"] },
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
