import { isRealDate, PRIORITIES, type Priority, STATUSES, type Status } from "@intesa/api/schemas"
import { normalise } from "@intesa/task-query"
import { usageError } from "../output/errors"

// A task as text for $EDITOR: YAML-style front matter for the properties, then the
// description in Markdown.
//
//   ---
//   title: Fix login redirect
//   status: in_progress
//   priority: high
//   due: 2026-10-15
//   assignees: [Mei Chen, @me]
//   tags: [auth, bug]
//   fields: { Estimate: 3, Stage: null }
//   ---
//   Markdown body…
//
// Only this much YAML is understood: one `key: value` per line, values that are plain or
// quoted scalars, inline lists `[a, b]` (or a bare `a, b` for assignees and tags) and inline
// maps `{ K: v }`, and `#` comments on their own line or after a value that cannot contain
// one. A key that is left out changes nothing; an empty value, `null` or `~` clears.

export type Scalar = string | null

export type TaskDoc = {
  title?: string
  status?: Status
  priority?: Priority | null
  due?: string | null
  assignees?: string[]
  tags?: string[]
  // By field name; values stay text until they are checked against the field's type.
  fields?: Record<string, Scalar>
  body: string
}

type DocTask = {
  title: string
  body: string | null
  status: Status
  priority: Priority | null
  dueAt: string | null
  assignees: readonly { id: string; name: string }[]
  tags: readonly { name: string }[]
  customFields: Record<string, unknown>
}

// What names people and fields: the signed-in user (written as @me), the workspace's members
// (a name two people share is written as the email) and the project's fields, in order.
export type DocNames = {
  meId?: string
  members?: readonly { userId: string; name: string; email: string }[]
  fields?: readonly { id: string; name: string }[]
}

const KEYS = ["title", "status", "priority", "due", "assignees", "tags", "fields"] as const
type Key = (typeof KEYS)[number]

const NULLS = ["", "null", "~"]

// Plain when it reads back as the same text, else double-quoted.
function scalar(value: Scalar): string {
  if (value === null) return "null"
  const plain =
    value === value.trim() &&
    !NULLS.includes(value.toLowerCase()) &&
    !/[,[\]{}"'#:\n\r\t\\]/.test(value)
  return plain ? value : JSON.stringify(value)
}

const list = (items: readonly Scalar[]) => `[${items.map(scalar).join(", ")}]`

export function formatTaskDoc(doc: TaskDoc): string {
  const lines = ["---"]
  const put = (key: Key, value: string) => lines.push(value ? `${key}: ${value}` : `${key}:`)
  if (doc.title !== undefined) put("title", scalar(doc.title))
  if (doc.status !== undefined) put("status", doc.status)
  if (doc.priority !== undefined) put("priority", doc.priority ?? "")
  if (doc.due !== undefined) put("due", doc.due ?? "")
  if (doc.assignees !== undefined) put("assignees", list(doc.assignees))
  if (doc.tags !== undefined) put("tags", list(doc.tags))
  if (doc.fields !== undefined) {
    const entries = Object.entries(doc.fields).map(([k, v]) => `${scalar(k)}: ${scalar(v)}`)
    put("fields", entries.length > 0 ? `{ ${entries.join(", ")} }` : "{}")
  }
  lines.push("---")
  const body = doc.body.trimEnd()
  return `${lines.join("\n")}\n${body ? `${body}\n` : ""}`
}

const fieldText = (value: unknown): Scalar =>
  value === undefined || value === null ? null : String(value)

export function toTaskDoc(task: DocTask, names: DocNames = {}): string {
  const members = names.members ?? []
  const person = (a: { id: string; name: string }) => {
    if (a.id === names.meId) return "@me"
    const namesakes = members.filter((m) => m.name.toLowerCase() === a.name.toLowerCase())
    return namesakes.length > 1 ? (members.find((m) => m.userId === a.id)?.email ?? a.id) : a.name
  }
  return formatTaskDoc({
    title: task.title,
    status: task.status,
    priority: task.priority,
    due: task.dueAt,
    assignees: task.assignees.map(person),
    tags: task.tags.map((t) => t.name),
    fields: Object.fromEntries(
      (names.fields ?? []).map((f) => [f.name, fieldText(task.customFields[f.id])]),
    ),
    body: task.body ?? "",
  })
}

class DocError extends Error {}
const fail = (message: string): never => {
  throw new DocError(message)
}

// A quoted scalar starting at text[at]; returns the value and the index after the quote.
// Double quotes take JSON's escapes, which is what `scalar` writes; in single quotes '' is a
// quote.
function quoted(text: string, at: number): [string, number] {
  if (text[at] === "'") {
    let out = ""
    for (let i = at + 1; i < text.length; i++) {
      if (text[i] !== "'") out += text[i]
      else if (text[i + 1] === "'") out += text[++i]
      else return [out, i + 1]
    }
    return fail("unclosed '")
  }
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === "\\") i++
    else if (text[i] === '"') {
      const raw = text.slice(at, i + 1)
      try {
        // A tab typed in the editor is meant as itself; JSON only takes it escaped.
        return [JSON.parse(raw.replaceAll("\t", "\\t")), i + 1]
      } catch {
        return fail(`invalid escape in ${raw}: use \\n, \\t, \\", \\\\ or \\uXXXX`)
      }
    }
  }
  return fail('unclosed "')
}

const isSpace = (c: string | undefined) => c === " " || c === "\t"

// One scalar from text[at] up to one of `stops` (outside quotes) or the end. Only a quote that
// starts it quotes it: O'Brien is plain. `end` is the index of the stop.
function item(text: string, at: number, stops: string) {
  let i = at
  while (isSpace(text[i])) i++
  if (text[i] === '"' || text[i] === "'") {
    const [value, after] = quoted(text, i)
    let end = after
    while (isSpace(text[end])) end++
    if (end < text.length && !stops.includes(text[end] as string)) {
      fail(`unexpected text after the quoted value: ${text.slice(after).trim()}`)
    }
    return { value: value as Scalar, blank: false, end }
  }
  let end = i
  while (end < text.length && !stops.includes(text[end] as string)) end++
  const raw = text.slice(i, end).trim()
  return { value: NULLS.includes(raw.toLowerCase()) ? null : raw, blank: !raw, end }
}

// Items separated by commas up to `close`, or to the end of the text without one. Returns
// them and the index after `close`.
function parseList(text: string, at: number, close = ""): [Scalar[], number] {
  const items: Scalar[] = []
  for (;;) {
    const { value, blank, end } = item(text, at, `,${close}`)
    if (!blank) items.push(value)
    if (close && text[end] === close) return [items, end + 1]
    if (end >= text.length)
      return close ? fail(`expected ${close} at the end of […]`) : [items, end]
    at = end + 1
  }
}

// `NAME: VALUE, …}` from just after the {. Names are matched without regard to case later,
// so the same name twice in another case is a mistake too.
function parseMap(text: string, at: number): [Record<string, Scalar>, number] {
  const map: Record<string, Scalar> = {}
  for (;;) {
    const key = item(text, at, ":,}")
    let end = key.end
    if (text[end] === ":") {
      const name = key.value || fail(`a name is missing in {…}: "${text.slice(at).trim()}"`)
      if (Object.keys(map).some((k) => k.toLowerCase() === name.toLowerCase())) {
        fail(`"${name}" is given twice in {…}`)
      }
      const value = item(text, end + 1, ",}")
      map[name] = value.value
      end = value.end
    } else if (!key.blank) {
      fail(`expected NAME: VALUE in {…}, got "${text.slice(at, end).trim()}"`)
    }
    if (text[end] === "}") return [map, end + 1]
    if (end >= text.length) return fail("expected } at the end of {…}")
    at = end + 1
  }
}

type Value = Scalar | Scalar[] | Record<string, Scalar>

// Values that never contain " #", so one starts a comment after them. A plain title is taken
// as typed, since titles often carry issue numbers.
const COMMENTED: readonly Key[] = ["status", "priority", "due"]

function parseValue(key: Key, text: string): Value {
  const t = text.trim()
  let value: Value
  let end: number
  if (t.startsWith("[")) [value, end] = parseList(t, 1, "]")
  else if (t.startsWith("{")) [value, end] = parseMap(t, 1)
  // `assignees: Mei Chen, Bob` is a list too.
  else if (key === "assignees" || key === "tags") [value, end] = parseList(t, 0)
  else if (t.startsWith('"') || t.startsWith("'")) [value, end] = quoted(t, 0)
  else {
    const plain = COMMENTED.includes(key) ? t.replace(/(^|\s)#.*$/, "").trim() : t
    return NULLS.includes(plain.toLowerCase()) ? null : plain
  }
  const rest = t.slice(end).trim()
  if (rest && !rest.startsWith("#")) fail(`unexpected text after the value: ${rest}`)
  return value
}

const oneOf = (value: string, allowed: readonly string[], what: string) => {
  const found = allowed.find((a) => a === normalise(value))
  return found ?? fail(`unknown ${what} "${value}": expected ${allowed.join(", ")}`)
}

function asText(key: Key, value: Value): Scalar {
  if (value !== null && typeof value === "object") fail(`${key} takes a single value`)
  return value as Scalar
}

function asList(key: Key, value: Value): string[] {
  if (value === null) return []
  if (typeof value === "string") return [value]
  if (!Array.isArray(value)) fail(`${key} takes a list like [a, b]`)
  return (value as Scalar[]).filter((v): v is string => v !== null)
}

function setKey(doc: TaskDoc, key: Key, value: Value) {
  switch (key) {
    case "title": {
      const title = asText(key, value)?.trim()
      doc.title = title || fail("a task needs a title")
      return
    }
    case "status": {
      const status = asText(key, value)
      doc.status = oneOf(status ?? fail("a task needs a status"), STATUSES, "status") as Status
      return
    }
    case "priority": {
      const priority = asText(key, value)
      doc.priority =
        priority === null || priority.toLowerCase() === "none"
          ? null
          : (oneOf(priority, PRIORITIES, "priority") as Priority)
      return
    }
    case "due": {
      const due = asText(key, value)
      if (due !== null && due.toLowerCase() !== "none" && !isRealDate(due)) {
        fail(`invalid due date "${due}": expected YYYY-MM-DD`)
      }
      doc.due = due === null || due.toLowerCase() === "none" ? null : due
      return
    }
    case "assignees":
    case "tags":
      doc[key] = asList(key, value)
      return
    case "fields":
      if (value === null) doc.fields = {}
      else if (typeof value === "object" && !Array.isArray(value)) doc.fields = value
      else fail("fields takes a map like { Estimate: 3 }")
  }
}

// Reads the document back. Mistakes are usage errors naming the line.
export function parseTaskDoc(text: string): TaskDoc {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n")
  const start = lines.findIndex((l) => l.trim())
  const at = (index: number, message: string) =>
    usageError(`task document, line ${index + 1}: ${message}`)
  if (start < 0 || lines[start]?.trim() !== "---") {
    throw at(Math.max(start, 0), "expected --- to start the front matter")
  }
  const end = lines.findIndex((l, i) => i > start && l.trim() === "---")
  if (end < 0) throw at(start, "expected a --- line to end the front matter started here")

  const doc: TaskDoc = { body: "" }
  const seen = new Set<string>()
  for (let i = start + 1; i < end; i++) {
    const line = lines[i] ?? ""
    if (!line.trim() || line.trim().startsWith("#")) continue
    // `s`: a value may hold U+2028 and U+2029, which `.` would stop at.
    const match = /^\s*([A-Za-z]+)\s*:(.*)$/s.exec(line)
    if (!match) throw at(i, `expected KEY: VALUE, got "${line.trim()}"`)
    const key = (match[1] ?? "").toLowerCase()
    if (!KEYS.includes(key as Key)) {
      throw at(i, `unknown key "${match[1]}": expected ${KEYS.join(", ")}`)
    }
    if (seen.has(key)) throw at(i, `${key} is given twice`)
    seen.add(key)
    try {
      setKey(doc, key as Key, parseValue(key as Key, match[2] ?? ""))
    } catch (err) {
      if (err instanceof DocError) throw at(i, err.message)
      throw err
    }
  }
  doc.body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "")
    .trimEnd()
  return doc
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const lower = (x: readonly string[]) => [...new Set(x.map((v) => v.toLowerCase()))].sort()
  return lower(a).join("\n") === lower(b).join("\n")
}

// What `after` changes compared with `before`: only keys present in `after` that differ.
// Lists are sets (order and case do not matter); fields compare one by one.
export function diffTaskDoc(before: TaskDoc, after: TaskDoc): Partial<TaskDoc> {
  const change: Partial<TaskDoc> = {}
  if (after.title !== undefined && after.title !== before.title) change.title = after.title
  if (after.status !== undefined && after.status !== before.status) change.status = after.status
  if (after.priority !== undefined && after.priority !== before.priority) {
    change.priority = after.priority
  }
  if (after.due !== undefined && after.due !== before.due) change.due = after.due
  if (after.assignees !== undefined && !sameSet(after.assignees, before.assignees ?? [])) {
    change.assignees = after.assignees
  }
  if (after.tags !== undefined && !sameSet(after.tags, before.tags ?? [])) change.tags = after.tags
  const fields = Object.entries(after.fields ?? {}).filter(([k, v]) => before.fields?.[k] !== v)
  if (fields.length > 0) change.fields = Object.fromEntries(fields)
  if (after.body !== before.body) change.body = after.body
  return change
}
