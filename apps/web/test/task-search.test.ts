import { describe, expect, test } from "bun:test"
import { applySuggestion, compileSearch, parseTerms, suggest } from "../src/lib/task-search"
import type { TaskSummary } from "../src/lib/tasks"

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "t1",
    projectId: "p1",
    number: 1,
    key: "AB-1",
    title: "Write the spec",
    body: null,
    status: "todo",
    priority: null,
    dueAt: null,
    parentTaskId: null,
    assignees: [],
    tags: [],
    subtaskCount: 0,
    subtaskDoneCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

const olive = { id: "u1", name: "Olive Owner", avatarUrl: null }
const bob = { id: "u2", name: "Bob", avatarUrl: null }
const bug = { id: "g1", name: "bug", color: "red" }
const NOW = new Date(2026, 5, 15)

/** Titles of the tasks a query keeps. */
function run(query: string, tasks: TaskSummary[], ctx = {}) {
  const matches = compileSearch(query, { now: NOW, ...ctx })
  return tasks.filter((t) => !matches || matches(t)).map((t) => t.title)
}

describe("parseTerms", () => {
  test("splits on whitespace and keeps quoted text together", () => {
    const terms = parseTerms('login "two words" priority:high')
    expect(terms.map((t) => t.rawValue)).toEqual(["login", "two words", "high"])
    expect(terms[2]).toMatchObject({ field: "priority", value: "high" })
  })

  test("reports where each term sits, so a suggestion can replace it", () => {
    expect(parseTerms("ab  cd").map((t) => [t.start, t.end])).toEqual([
      [0, 2],
      [4, 6],
    ])
  })

  test("a leading dash negates, and the field name is case-insensitive", () => {
    expect(parseTerms("-Priority:Low")[0]).toMatchObject({
      negated: true,
      field: "priority",
      value: "low",
    })
  })

  test("unknown fields and a lone dash are plain text", () => {
    expect(parseTerms("foo:bar")[0]?.field).toBeUndefined()
    expect(parseTerms("foo:bar")[0]?.value).toBe("foo:bar")
    expect(parseTerms("-")[0]).toMatchObject({ negated: false, value: "-" })
  })

  test("a colon inside quotes does not make a field", () => {
    expect(parseTerms('"priority:high"')[0]?.field).toBeUndefined()
  })

  test("an unclosed quote runs to the end instead of throwing", () => {
    expect(parseTerms('"half open')[0]).toMatchObject({ rawValue: "half open", end: 10 })
  })
})

describe("compileSearch", () => {
  const spec = task({ id: "a", title: "Write spec", body: "Cover the API", priority: "medium" })
  const release = task({ id: "b", title: "Ship release", key: "AB-2", priority: "high" })
  const login = task({ id: "c", title: "Fix login bug", status: "review", priority: "urgent" })
  const all = [spec, release, login]

  test("an empty or unfinished query filters nothing", () => {
    expect(compileSearch("")).toBeNull()
    expect(compileSearch("   ")).toBeNull()
    expect(compileSearch("priority:")).toBeNull()
    expect(run("priority: ship", all)).toEqual(["Ship release"])
  })

  test("free text matches title, description and key, ignoring case", () => {
    expect(run("LOGIN", all)).toEqual(["Fix login bug"])
    expect(run("cover spec", all)).toEqual(["Write spec"]) // words are separate terms, in any order
    expect(run("cover login", all)).toEqual([])
    expect(run('"cover the api"', all)).toEqual(["Write spec"])
    expect(run("ab-2", all)).toEqual(["Ship release"])
  })

  test("every term must match", () => {
    expect(run("priority:medium spec", all)).toEqual(["Write spec"])
    expect(run("priority:medium login", all)).toEqual([])
  })

  test("a dash excludes matches, for fields and for text", () => {
    expect(run("-priority:medium", all)).toEqual(["Ship release", "Fix login bug"])
    expect(run("-ship", all)).toEqual(["Write spec", "Fix login bug"])
  })

  test("comma separated values match any of them", () => {
    expect(run("priority:high,urgent", all)).toEqual(["Ship release", "Fix login bug"])
  })

  test("status accepts a prefix and spaces or dashes for in progress", () => {
    const working = task({ title: "Working", status: "in_progress" })
    expect(run("status:in", [working, spec])).toEqual(["Working"])
    expect(run('status:"in progress"', [working, spec])).toEqual(["Working"])
    expect(run("status:in-progress", [working, spec])).toEqual(["Working"])
  })

  test("priority:none finds tasks without a priority", () => {
    expect(run("priority:none", [spec, task({ title: "Unranked" })])).toEqual(["Unranked"])
  })

  test("assignee matches names, me and unassigned", () => {
    const mine = task({ title: "Mine", assignees: [olive] })
    const bobs = task({ title: "Bobs", assignees: [bob] })
    const nobody = task({ title: "Nobody" })
    const tasks = [mine, bobs, nobody]
    expect(run("assignee:bob", tasks)).toEqual(["Bobs"])
    expect(run('assignee:"olive owner"', tasks)).toEqual(["Mine"])
    expect(run("assignee:me", tasks, { meId: "u1" })).toEqual(["Mine"])
    expect(run("assignee:me", tasks)).toEqual([]) // not signed in yet: nobody is "me"
    expect(run("assignee:unassigned", tasks)).toEqual(["Nobody"])
  })

  test("tag matches part of a tag name", () => {
    const tagged = task({ title: "Tagged", tags: [bug] })
    expect(run("tag:bu", [tagged, task({ title: "Plain" })])).toEqual(["Tagged"])
  })

  test("due understands overdue, soon, today, none and dates", () => {
    const overdue = task({ title: "Overdue", dueAt: "2026-06-10" })
    const soon = task({ title: "Soon", dueAt: "2026-06-16" })
    const today = task({ title: "Today", dueAt: "2026-06-15" })
    const far = task({ title: "Far", dueAt: "2026-09-01" })
    const done = task({ title: "Done", dueAt: "2026-06-10", status: "complete" })
    const open = task({ title: "Open" })
    const tasks = [overdue, soon, today, far, done, open]
    expect(run("due:overdue", tasks)).toEqual(["Overdue"]) // completed work is never overdue
    expect(run("due:soon", tasks)).toEqual(["Soon", "Today"])
    expect(run("due:today", tasks)).toEqual(["Today"])
    expect(run("due:none", tasks)).toEqual(["Open"])
    expect(run("due:2026-09", tasks)).toEqual(["Far"])
  })

  test("has: and no: test for a property", () => {
    const rich = task({
      title: "Rich",
      body: "text",
      tags: [bug],
      assignees: [bob],
      subtaskCount: 2,
    })
    const bare = task({ title: "Bare", body: "  " })
    expect(run("has:description", [rich, bare])).toEqual(["Rich"])
    expect(run("no:description", [rich, bare])).toEqual(["Bare"])
    expect(run("has:subtasks has:tag has:assignee", [rich, bare])).toEqual(["Rich"])
    expect(run("no:tag,assignee", [rich, bare])).toEqual(["Bare"])
    expect(run("has:nonsense", [rich, bare])).toEqual(["Rich", "Bare"])
  })
})

describe("suggest", () => {
  const tasks = [
    task({ assignees: [olive], tags: [bug] }),
    task({ assignees: [bob, olive], tags: [{ id: "g2", name: "ui", color: "blue" }] }),
  ]
  const labels = (query: string, caret = query.length) =>
    suggest(query, caret, tasks).suggestions.map((s) => s.label)

  test("an empty query lists every field", () => {
    expect(labels("")).toEqual(["status:", "priority:", "assignee:", "tag:", "due:", "has:", "no:"])
  })

  test("a partial word completes to the fields that start with it", () => {
    expect(labels("pri")).toEqual(["priority:"])
    expect(labels("a")).toEqual(["assignee:"])
    expect(labels("zzz")).toEqual([])
  })

  test("a finished field name is not offered again", () => {
    expect(labels("tag")).toEqual([])
  })

  test("after the colon it offers that field's values", () => {
    expect(labels("priority:")).toEqual(["low", "medium", "high", "urgent", "none"])
    expect(labels("priority:m")).toEqual(["medium"])
    expect(labels("status:in")).toEqual(["in_progress"])
  })

  test("people and tags come from the tasks, once each", () => {
    expect(labels("assignee:")).toEqual(["me", "unassigned", "Bob", "Olive Owner"])
    expect(labels("tag:")).toEqual(["bug", "ui"])
  })

  test("a later word of a name matches, and the name is quoted on insert", () => {
    const [owner] = suggest("assignee:ow", 11, tasks).suggestions
    expect(owner?.label).toBe("Olive Owner")
    expect(owner?.insert).toBe('assignee:"Olive Owner"')
  })

  test("values already chosen in a comma list are not offered again", () => {
    expect(labels("priority:low,")).toEqual(["medium", "high", "urgent", "none"])
    expect(suggest("priority:low,m", 14, tasks).suggestions[0]?.insert).toBe("priority:low,medium")
  })

  test("a dash in front is kept", () => {
    expect(suggest("-pri", 4, tasks).suggestions[0]?.insert).toBe("-priority:")
    expect(suggest("-priority:u", 11, tasks).suggestions[0]?.insert).toBe("-priority:urgent")
  })

  test("nothing is offered for quoted text or unknown fields", () => {
    expect(labels('"pri')).toEqual([])
    expect(labels("foo:")).toEqual([])
  })

  test("nothing is offered between terms unless the query is empty", () => {
    expect(labels("priority:low ")).toEqual([])
  })

  test("only the term under the caret is completed", () => {
    const result = suggest("pri status:todo", 3, tasks)
    expect(result.suggestions.map((s) => s.label)).toEqual(["priority:"])
    expect(result).toMatchObject({ start: 0, end: 3 })
  })
})

describe("applySuggestion", () => {
  test("a field name leaves the caret after the colon, ready for the value", () => {
    const s = { label: "priority:", insert: "priority:", partial: true }
    expect(applySuggestion("pri", { start: 0, end: 3 }, s)).toEqual({
      query: "priority:",
      caret: 9,
    })
  })

  test("a value ends the term with a space and keeps what follows", () => {
    const s = { label: "medium", insert: "priority:medium", partial: false }
    expect(applySuggestion("priority:m bug", { start: 0, end: 10 }, s)).toEqual({
      query: "priority:medium bug",
      caret: 16,
    })
  })
})
