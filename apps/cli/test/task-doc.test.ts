import { describe, expect, test } from "bun:test"
import {
  diffTaskDoc,
  formatTaskDoc,
  parseTaskDoc,
  type TaskDoc,
  toTaskDoc,
} from "../src/io/task-doc"
import { CliError } from "../src/output/errors"
import { fromDoc, toDoc } from "../src/tui/edit-doc"

const task = {
  title: "Fix login redirect",
  body: "Markdown body\n\n- with a list\n",
  status: "in_progress" as const,
  priority: "high" as const,
  dueAt: "2026-10-15",
  assignees: [
    { id: "u-alan", name: "Alan Owner" },
    { id: "u-mei", name: "Mei Chen" },
  ],
  tags: [{ name: "auth" }, { name: "bug" }],
  customFields: { f1: 3, f3: true },
}
const names = {
  meId: "u-alan",
  members: [
    { userId: "u-alan", name: "Alan Owner", email: "alan@example.com" },
    { userId: "u-mei", name: "Mei Chen", email: "mei@example.com" },
  ],
  fields: [
    { id: "f1", name: "Estimate" },
    { id: "f2", name: "Stage" },
    { id: "f3", name: "Shipped" },
  ],
}

// The error a document mistake gives: a usage error naming the line.
function parseError(text: string): CliError {
  try {
    parseTaskDoc(text)
  } catch (err) {
    if (err instanceof CliError) return err
    throw err
  }
  throw new Error("parsed without an error")
}

const doc = (...lines: string[]) => `---\n${lines.join("\n")}\n---\n`

describe("toTaskDoc", () => {
  test("front matter with every property, then the description", () => {
    expect(toTaskDoc(task, names)).toBe(
      [
        "---",
        "title: Fix login redirect",
        "status: in_progress",
        "priority: high",
        "due: 2026-10-15",
        "assignees: [@me, Mei Chen]",
        "tags: [auth, bug]",
        "reviewedBy:",
        "testedBy:",
        "fields: { Estimate: 3, Stage: null, Shipped: true }",
        "---",
        "Markdown body",
        "",
        "- with a list",
        "",
      ].join("\n"),
    )
  })

  test("reviewedBy and testedBy: empty while unanswered, none for nobody, else the person", () => {
    const text = toTaskDoc(
      { ...task, reviewedBy: { id: "u-mei", name: "Mei Chen" }, testedBy: null },
      names,
    )
    expect(text).toContain("\nreviewedBy: Mei Chen\ntestedBy: none\n")
    const me = toTaskDoc({ ...task, testedBy: { id: "u-alan", name: "Alan Owner" } }, names)
    expect(me).toContain("\nreviewedBy:\ntestedBy: @me\n")
  })

  test("empty values for no priority, no due date and no description", () => {
    const text = toTaskDoc({ ...task, priority: null, dueAt: null, body: null, assignees: [] })
    expect(text).toContain("\npriority:\n")
    expect(text).toContain("\ndue:\n")
    expect(text).toContain("\nassignees: []\n")
    expect(text).toContain("\nfields: {}\n")
    expect(text.endsWith("---\n")).toBe(true)
  })

  test("a name two members share is written as the email", () => {
    const twins = {
      ...names,
      members: [
        ...names.members,
        { userId: "u-mei2", name: "mei chen", email: "mei2@example.com" },
      ],
    }
    expect(toTaskDoc(task, twins)).toContain("assignees: [@me, mei@example.com]")
  })
})

describe("parseTaskDoc", () => {
  test("reads back what toTaskDoc writes", () => {
    expect(parseTaskDoc(toTaskDoc(task, names))).toEqual({
      title: "Fix login redirect",
      status: "in_progress",
      priority: "high",
      due: "2026-10-15",
      assignees: ["@me", "Mei Chen"],
      tags: ["auth", "bug"],
      reviewedBy: null,
      testedBy: null,
      fields: { Estimate: "3", Stage: null, Shipped: "true" },
      body: "Markdown body\n\n- with a list",
    })
  })

  test("reviewedBy and testedBy keys are read without regard to case", () => {
    expect(parseTaskDoc(doc("reviewedby: Mei Chen", "TESTEDBY: none"))).toMatchObject({
      reviewedBy: "Mei Chen",
      testedBy: "none",
    })
  })

  test("awkward text survives the round trip", () => {
    const awkward: TaskDoc = {
      title: 'Fix: "login" #12, again \\ really',
      assignees: ["Doe, Jane", "O'Brien"],
      tags: ["null", "a]b", " padded "],
      fields: { "Odd: name": "10:30", Notes: "", Empty: null },
      body: "---\nnot front matter\n---",
    }
    expect(parseTaskDoc(formatTaskDoc(awkward))).toEqual(awkward)
  })

  test("a comma or a colon inside a quoted field value stays in the value", () => {
    const text = toTaskDoc(
      { ...task, customFields: { f1: 3, f2: "red, green", f3: "at 10:30, {maybe}" } },
      names,
    )
    expect(parseTaskDoc(text).fields).toEqual({
      Estimate: "3",
      Stage: "red, green",
      Shipped: "at 10:30, {maybe}",
    })
  })

  test("every escape JSON writes reads back", () => {
    const escaped: TaskDoc = {
      title: "a\rb\bc\fd\u0001e f\ttab\\",
      tags: ['quote " inside', "new\nline"],
      fields: { "Odd\u0007name": "\r\n" },
      body: "",
    }
    expect(parseTaskDoc(formatTaskDoc(escaped))).toEqual(escaped)
  })

  test("a trailing # comment after a value that cannot contain one", () => {
    expect(
      parseTaskDoc(
        doc(
          "status: review   # later",
          "priority: high # note",
          "due: 2026-10-15 # Friday",
          'title: "Fix" # quoted',
          "tags: [a, b] # list",
          "fields: { A: 1 } # map",
        ),
      ),
    ).toEqual({
      title: "Fix",
      status: "review",
      priority: "high",
      due: "2026-10-15",
      tags: ["a", "b"],
      fields: { A: "1" },
      body: "",
    })
    // A plain title is taken as typed: issue numbers are common in titles.
    expect(parseTaskDoc(doc("title: Fix bug #12")).title).toBe("Fix bug #12")
  })

  test("a list key takes a bare comma list", () => {
    expect(parseTaskDoc(doc("assignees: Mei Chen, Bob", 'tags: "a, b", c,'))).toEqual({
      assignees: ["Mei Chen", "Bob"],
      tags: ["a, b", "c"],
      body: "",
    })
  })

  test("is lenient where people type: CRLF, comments, labels, quotes, none, single values", () => {
    const text = [
      "﻿",
      "---",
      "# what changed",
      "Title:   'It''s done'  ",
      "",
      "status: In progress",
      "priority: none",
      "due: ~",
      "assignees: alan@example.com",
      "tags:",
      "fields: { 'Estimate' : 5, Stage: \"Beta\" }",
      "---",
      "",
      "",
      "Body  ",
    ].join("\r\n")
    expect(parseTaskDoc(text)).toEqual({
      title: "It's done",
      status: "in_progress",
      priority: null,
      due: null,
      assignees: ["alan@example.com"],
      tags: [],
      fields: { Estimate: "5", Stage: "Beta" },
      body: "Body",
    })
  })

  test("keys left out stay unset", () => {
    expect(parseTaskDoc(doc("title: Only this"))).toEqual({ title: "Only this", body: "" })
  })

  test.each([
    ["no front matter", "Just a body\n", 1, "expected --- to start"],
    ["no end to it", "\n---\ntitle: x\n", 2, "expected a --- line to end"],
    ["an unknown key", doc("title: x", "owner: me"), 3, 'unknown key "owner"'],
    ["a key twice", doc("tags: [a]", "title: x", "tags: [b]"), 4, "tags is given twice"],
    ["a line that is not KEY: VALUE", doc("title x"), 2, "expected KEY: VALUE"],
    ["an empty title", doc("title:  "), 2, "a task needs a title"],
    ["an unknown status", doc("status: doing"), 2, 'unknown status "doing"'],
    ["an unknown priority", doc("priority: big"), 2, 'unknown priority "big"'],
    ["a date that does not exist", doc("due: 2026-02-31"), 2, "expected YYYY-MM-DD"],
    ["a list as the title", doc("title: [a, b]"), 2, "title takes a single value"],
    ["a list of fields", doc("fields: [a]"), 2, "fields takes a map"],
    ["a field without a value", doc("fields: { Estimate }"), 2, "expected NAME: VALUE"],
    ["an unclosed list", doc("tags: [a, b"), 2, "expected ]"],
    ["an unclosed quote", doc('title: "Fix'), 2, 'unclosed "'],
    ["text after a quoted value", doc('title: "Fix" now'), 2, "unexpected text"],
    ["text after a list", doc("tags: [a] b"), 2, "unexpected text"],
    ["an unknown escape", doc('title: "a\\qb"'), 2, "invalid escape"],
    ["a field twice", doc("fields: { Stage: 1, stage: 2 }"), 2, '"stage" is given twice'],
    ["a field without a name", doc("fields: { : 2 }"), 2, "a name is missing"],
  ])("%s is a usage error naming the line", (_name, text, line, message) => {
    const err = parseError(text)
    expect(err.exitCode).toBe(2)
    expect(err.message).toContain(`line ${line}:`)
    expect(err.message).toContain(message)
  })
})

describe("diffTaskDoc", () => {
  const before = parseTaskDoc(toTaskDoc(task, names))
  const edit = (from: string, to: string) => {
    const text = toTaskDoc(task, names)
    if (!text.includes(from)) throw new Error(`no "${from}" in the document`)
    return diffTaskDoc(before, parseTaskDoc(text.replace(from, to)))
  }

  test("nothing changed is empty", () => {
    expect(diffTaskDoc(before, parseTaskDoc(toTaskDoc(task, names)))).toEqual({})
  })

  test("only what changed", () => {
    expect(edit("status: in_progress", "status: review")).toEqual({ status: "review" })
    expect(edit("priority: high", "priority:")).toEqual({ priority: null })
    expect(edit("due: 2026-10-15", "due: 2026-11-01")).toEqual({ due: "2026-11-01" })
    expect(edit("- with a list", "- with a longer list")).toEqual({
      body: "Markdown body\n\n- with a longer list",
    })
  })

  test("lists are sets: order and case do not count, the whole new set is given", () => {
    expect(edit("tags: [auth, bug]", "tags: [BUG, auth]")).toEqual({})
    expect(edit("tags: [auth, bug]", "tags: [bug, ui]")).toEqual({ tags: ["bug", "ui"] })
    expect(edit("assignees: [@me, Mei Chen]", "assignees: []")).toEqual({ assignees: [] })
  })

  test("fields compare one by one; null clears and a new name is a change", () => {
    expect(edit("Estimate: 3", "Estimate: 5")).toEqual({ fields: { Estimate: "5" } })
    expect(edit("Shipped: true", "Shipped: null")).toEqual({ fields: { Shipped: null } })
    expect(edit("Stage: null", "Stage: null, Points: 2")).toEqual({ fields: { Points: "2" } })
  })

  test("answering who reviewed or tested is a change; emptying an answer is refused", () => {
    expect(edit("testedBy:", "testedBy: none")).toEqual({ testedBy: "none" })
    expect(edit("reviewedBy:", "reviewedBy: Mei Chen")).toEqual({ reviewedBy: "Mei Chen" })
    // Answered the same way is no change.
    const answered = parseTaskDoc(
      toTaskDoc({ ...task, reviewedBy: { id: "u-mei", name: "Mei Chen" } }, names),
    )
    const same = { ...answered, reviewedBy: "mei chen" }
    expect(diffTaskDoc(answered, same)).toEqual({})
    expect(() => diffTaskDoc(answered, { ...answered, reviewedBy: null })).toThrow(
      "reviewedBy is already answered",
    )
  })

  test("a key that was deleted changes nothing; an emptied description does", () => {
    expect(edit("tags: [auth, bug]\n", "")).toEqual({})
    expect(edit("fields: { Estimate: 3, Stage: null, Shipped: true }\n", "")).toEqual({})
    expect(edit("Markdown body\n\n- with a list\n", "")).toEqual({ body: "" })
  })
})

describe("the board's editor document", () => {
  test("is the task document with the title, and reads back", () => {
    const text = toDoc("Draft: v2", "Some notes\n")
    expect(text).toBe('---\ntitle: "Draft: v2"\n---\nSome notes\n')
    expect(fromDoc(text)).toEqual({ title: "Draft: v2", body: "Some notes" })
  })

  test("a document that does not read gives no title, so nothing is saved", () => {
    expect(fromDoc("# Old style\n\nbody").title).toBe("")
  })
})
