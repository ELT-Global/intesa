import { styleText } from "node:util"
import { relativeTime } from "@intesa/task-query"

type Row = Record<string, unknown>
const GAP = 2

export function cell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (Array.isArray(value)) return value.map(cell).join(",")
  if (typeof value === "object") {
    // People, tags, projects: what they are called reads better than their JSON.
    const { name } = value as { name?: unknown }
    return typeof name === "string" ? cell(name) : JSON.stringify(value)
  }
  // Tabs and newlines would break TSV rows and table alignment alike.
  return String(value).replace(/[\t\r\n]+/g, " ")
}

// What a null timestamp means for the few that mean something.
const NULL_TIMESTAMP: Record<string, string> = { lastUsedAt: "never", expiresAt: "no expiry" }
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/

// On a terminal, a timestamp field (createdAt, lastUsedAt, … : any name ending in `At`) reads
// relative to now, like "2 hours ago". Days such as a task's dueAt are not timestamps and
// keep their date. Undefined when the value is left as it is.
export function timestampText(field: string, value: unknown): string | undefined {
  if (!field.endsWith("At")) return undefined
  if (value === null || value === undefined) return NULL_TIMESTAMP[field]
  return typeof value === "string" && ISO_TIMESTAMP.test(value) ? relativeTime(value) : undefined
}

// Cuts text to a display width, ending in "…" when anything was cut.
export function truncate(text: string, width: number) {
  if (Bun.stringWidth(text) <= width) return text
  return width <= 1 ? "…".slice(0, width) : `${Bun.sliceAnsi(text, 0, width - 1)}…`
}

export const pad = (text: string, width: number) =>
  text + " ".repeat(Math.max(width - Bun.stringWidth(text), 0))

// On a terminal: a header and aligned columns fitted to the width, shrinking the widest
// column first. Piped: TSV with no header or truncation, so scripts can rely on it.
export function formatTable(
  rows: Row[],
  columns: string[],
  opts: { tty: boolean; width: number; color?: boolean; header?: boolean },
): string {
  if (rows.length === 0) return ""
  if (!opts.tty)
    return rows.map((row) => `${columns.map((c) => cell(row[c])).join("\t")}\n`).join("")
  const body = rows.map((row) => columns.map((c) => timestampText(c, row[c]) ?? cell(row[c])))

  const showHeader = opts.header ?? true
  const header = columns.map((c) => (showHeader ? c.toUpperCase() : ""))
  const widths = columns.map((_, i) =>
    Math.max(Bun.stringWidth(header[i] ?? ""), ...body.map((r) => Bun.stringWidth(r[i] ?? ""))),
  )
  const budget = opts.width - GAP * (columns.length - 1)
  while (widths.reduce((a, b) => a + b, 0) > budget) {
    const widest = widths.indexOf(Math.max(...widths))
    if ((widths[widest] ?? 0) <= 4) break
    widths[widest] = (widths[widest] ?? 0) - 1
  }

  const line = (cells: string[]) =>
    cells
      .map((c, i) => pad(truncate(c, widths[i] ?? 0), widths[i] ?? 0))
      .join(" ".repeat(GAP))
      .trimEnd()
  const lines = body.map(line)
  if (showHeader) {
    const head = line(header)
    lines.unshift(opts.color ? styleText("bold", head) : head)
  }
  return `${lines.join("\n")}\n`
}
