import { usageError } from "./errors"

// Parses `--fields a,b`. With a known field set, unknown names fail up front instead of
// silently printing nulls.
export function selectFields(spec: string | undefined, available: readonly string[] | undefined) {
  if (spec === undefined) return undefined
  const fields = spec
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
  if (fields.length === 0) throw usageError("--fields needs at least one field name")
  const unknown = available && fields.find((f) => !available.includes(f))
  if (unknown) {
    throw usageError(`unknown field "${unknown}" (available: ${available.join(", ")})`)
  }
  return fields
}

const pick = (row: unknown, fields: string[]) => {
  if (row === null || typeof row !== "object") return row
  const source = row as Record<string, unknown>
  return Object.fromEntries(fields.map((f) => [f, source[f] ?? null]))
}

export function project(value: unknown, fields: string[] | undefined): unknown {
  if (!fields) return value
  return Array.isArray(value) ? value.map((row) => pick(row, fields)) : pick(value, fields)
}

export const toJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
