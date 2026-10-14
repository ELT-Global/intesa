import { describe, expect, test } from "bun:test"
import {
  formatWeek,
  parseWeek,
  shiftWeek,
  type WeekTaskInput,
  weekBounds,
  weekCounts,
  weekLogHtml,
  weekLogMarkdown,
  weekLogSimpleMarkdown,
  weekOf,
} from "../src"

// Wednesday afternoon in the week of Monday 2026-10-12.
const NOW = new Date(2026, 9, 14, 15, 30)

describe("weekOf", () => {
  test("any day of the week maps to its Monday", () => {
    expect(weekOf("2026-10-12")).toBe("2026-10-12")
    expect(weekOf("2026-10-14")).toBe("2026-10-12")
    expect(weekOf("2026-10-18")).toBe("2026-10-12")
    expect(weekOf("2026-10-19")).toBe("2026-10-19")
  })

  test("a Date uses its local day, whatever the time", () => {
    expect(weekOf(new Date(2026, 9, 18, 23, 59))).toBe("2026-10-12")
    expect(weekOf(new Date(2026, 9, 19, 0, 0))).toBe("2026-10-19")
  })

  test("the Monday can fall in the previous month or year", () => {
    expect(weekOf("2026-11-01")).toBe("2026-10-26")
    expect(weekOf("2027-01-01")).toBe("2026-12-28")
  })
})

describe("shiftWeek", () => {
  test("moves whole weeks in either direction", () => {
    expect(shiftWeek("2026-10-12", 1)).toBe("2026-10-19")
    expect(shiftWeek("2026-10-12", -2)).toBe("2026-09-28")
    expect(shiftWeek("2026-10-12", 0)).toBe("2026-10-12")
  })

  test("crosses month and year boundaries", () => {
    expect(shiftWeek("2026-10-26", 1)).toBe("2026-11-02")
    expect(shiftWeek("2026-12-28", 1)).toBe("2027-01-04")
    expect(shiftWeek("2027-01-04", -1)).toBe("2026-12-28")
    expect(shiftWeek("2028-02-28", 1)).toBe("2028-03-06")
  })
})

describe("weekBounds", () => {
  test("runs from local midnight on Monday to local midnight on the next Monday", () => {
    expect(weekBounds("2026-10-12")).toEqual({
      from: new Date(2026, 9, 12).toISOString(),
      to: new Date(2026, 9, 19).toISOString(),
    })
  })

  test("stays on local midnights across daylight saving changes", () => {
    for (const [y, m, d] of [
      [2026, 3, 23],
      [2026, 3, 30],
      [2026, 10, 26],
      [2026, 11, 2],
      [2026, 12, 28],
    ] as const) {
      const monday = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      expect(weekBounds(monday)).toEqual({
        from: new Date(y, m - 1, d).toISOString(),
        to: new Date(y, m - 1, d + 7).toISOString(),
      })
    }
  })

  test("a week is about seven days long", () => {
    const { from, to } = weekBounds("2026-03-23")
    const hours = (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000
    expect(Math.abs(hours - 168)).toBeLessThanOrEqual(1)
  })
})

describe("parseWeek", () => {
  test("this, last and next are relative to now, in any case", () => {
    expect(parseWeek("this", NOW)).toBe("2026-10-12")
    expect(parseWeek("LAST", NOW)).toBe("2026-10-05")
    expect(parseWeek("Next", NOW)).toBe("2026-10-19")
  })

  test("a day is normalised to the Monday of its week", () => {
    expect(parseWeek("2026-10-18", NOW)).toBe("2026-10-12")
    expect(parseWeek("2026-10-12", NOW)).toBe("2026-10-12")
    expect(parseWeek("2027-01-01", NOW)).toBe("2026-12-28")
  })

  test("anything else is undefined", () => {
    expect(parseWeek("", NOW)).toBeUndefined()
    expect(parseWeek("soon", NOW)).toBeUndefined()
    expect(parseWeek("2026-10", NOW)).toBeUndefined()
    expect(parseWeek("2026-10-1", NOW)).toBeUndefined()
    expect(parseWeek("10/12/2026", NOW)).toBeUndefined()
  })

  test("days that do not exist are undefined", () => {
    expect(parseWeek("2026-02-31", NOW)).toBeUndefined()
    expect(parseWeek("2026-13-01", NOW)).toBeUndefined()
    expect(parseWeek("2026-00-10", NOW)).toBeUndefined()
    expect(parseWeek("2026-04-31", NOW)).toBeUndefined()
    expect(parseWeek("2027-02-29", NOW)).toBeUndefined()
    expect(parseWeek("2028-02-29", NOW)).toBe("2028-02-28")
  })
})

describe("formatWeek", () => {
  test("a week inside one month names the month once", () => {
    expect(formatWeek("2026-10-12", NOW)).toBe("Oct 12 – 18, 2026")
  })

  test("a week across months names both", () => {
    expect(formatWeek("2026-09-28", NOW)).toBe("Sep 28 – Oct 4, 2026")
  })

  test("a week across years names both years", () => {
    expect(formatWeek("2026-12-28", NOW)).toBe("Dec 28, 2026 – Jan 3, 2027")
  })
})

function task(overrides: Partial<WeekTaskInput> = {}): WeekTaskInput {
  return {
    key: "WEB-1",
    title: "Task",
    status: "todo",
    completedAt: null,
    assignedAt: new Date(2026, 9, 12, 9).toISOString(),
    plannedAt: null,
    carriedOver: false,
    unassignedAt: null,
    ...overrides,
  }
}

describe("weekCounts", () => {
  test("counts completed, pending and carried over", () => {
    const tasks = [
      task({ status: "complete" }),
      task({ status: "complete", carriedOver: true }),
      task({ status: "in_progress", carriedOver: true }),
      task({ status: "todo" }),
      task({ status: "review" }),
    ]
    expect(weekCounts(tasks)).toEqual({
      total: 5,
      completed: 2,
      pending: 3,
      carriedOver: 2,
      added: 3,
    })
  })

  test("no tasks is all zeros", () => {
    expect(weekCounts([])).toEqual({ total: 0, completed: 0, pending: 0, carriedOver: 0, added: 0 })
  })
})

describe("weekLogMarkdown", () => {
  const at = (month: number, day: number, hour = 10) =>
    new Date(2026, month - 1, day, hour).toISOString()
  const WEEK = "2026-10-12"

  const log = {
    people: [
      {
        user: { name: "Ada Lovelace" },
        member: true,
        tasks: [
          task({
            key: "WEB-12",
            title: "Fix login redirect",
            status: "complete",
            completedAt: at(10, 14),
            assignedAt: at(10, 12),
          }),
          task({
            key: "WEB-15",
            title: "Add CSV export",
            status: "in_progress",
            assignedAt: at(9, 20),
            // Left Backlog after it was assigned, so that is the date shown.
            plannedAt: at(10, 2),
            carriedOver: true,
          }),
          task({
            key: "API-3",
            title: "Rate limit",
            assignedAt: at(10, 15),
            unassignedAt: at(10, 16),
          }),
        ],
      },
      { user: { name: "Grace Hopper" }, member: true, tasks: [] },
      { user: { name: "Former Member" }, member: false, tasks: [] },
    ],
  }

  test("renders the whole week with links", () => {
    const markdown = weekLogMarkdown(log, {
      week: WEEK,
      workspace: "Acme",
      taskUrl: (t) => `https://intesa.test/t/${t.key}`,
      now: NOW,
    })
    expect(markdown).toBe(
      [
        "# Weekly log · Oct 12 – 18, 2026",
        "",
        "Acme · 1 completed · 2 pending",
        "",
        "## Ada Lovelace",
        "",
        "1 completed · 2 pending",
        "",
        "**Completed**",
        "",
        "- [x] [WEB-12](https://intesa.test/t/WEB-12) Fix login redirect — completed Wed, Oct 14 · assigned Mon, Oct 12",
        "",
        "**Pending**",
        "",
        "- [ ] [WEB-15](https://intesa.test/t/WEB-15) Add CSV export — In progress · carried over, assigned Fri, Oct 2",
        "- [ ] [API-3](https://intesa.test/t/API-3) Rate limit — Todo · assigned Thu, Oct 15 · unassigned Fri, Oct 16",
        "",
        "**Nothing this week:** Grace Hopper",
        "",
      ].join("\n"),
    )
  })

  test("a task shared by two people counts once in the totals", () => {
    const shared = log.people[0]?.tasks[0]
    if (!shared) throw new Error("fixture")
    const markdown = weekLogMarkdown(
      { people: [...log.people, { user: { name: "Bo" }, member: true, tasks: [shared] }] },
      { week: WEEK, workspace: "Acme", now: NOW },
    )
    expect(markdown).toContain("Acme · 1 completed · 2 pending\n")
    expect(markdown).toContain("## Bo\n\n1 completed\n")
  })

  test("keys are plain text without taskUrl, and the workspace is optional", () => {
    const markdown = weekLogMarkdown(log, { week: WEEK, now: NOW })
    expect(markdown).toContain("\n\n1 completed · 2 pending\n\n## Ada Lovelace")
    expect(markdown).toContain("- [x] WEB-12 Fix login redirect — ")
    expect(markdown).not.toContain("](")
  })

  test("ends with one newline and has no trailing spaces or double blank lines", () => {
    const markdown = weekLogMarkdown(log, { week: WEEK, workspace: "Acme", now: NOW })
    expect(markdown.endsWith("\n")).toBe(true)
    expect(markdown.endsWith("\n\n")).toBe(false)
    expect(markdown).not.toMatch(/ \n/)
    expect(markdown).not.toContain("\n\n\n")
  })

  test("a former member with tasks is listed, one without is not", () => {
    const markdown = weekLogMarkdown(
      { people: [{ user: { name: "Former Member" }, member: false, tasks: [task()] }] },
      { week: WEEK, now: NOW },
    )
    expect(markdown).toContain("## Former Member\n\n1 pending\n")
    expect(weekLogMarkdown(log, { week: WEEK, now: NOW })).not.toContain("Former Member")
  })

  test("a person with only completed work has no Pending group", () => {
    const markdown = weekLogMarkdown(
      { people: [{ user: { name: "Ada" }, member: true, tasks: [task({ status: "complete" })] }] },
      { week: WEEK, now: NOW },
    )
    expect(markdown).toContain("**Completed**")
    expect(markdown).not.toContain("**Pending**")
  })

  test("titles cannot break the Markdown", () => {
    const markdown = weekLogMarkdown(
      {
        people: [
          {
            user: { name: "Ada" },
            member: true,
            tasks: [
              task({ title: "# Fix [the] *bold* snake_case `code` back\\slash" }),
              task({ title: "Two\nlines" }),
            ],
          },
        ],
      },
      { week: WEEK, now: NOW },
    )
    expect(markdown).toContain(
      "- [ ] WEB-1 \\# Fix \\[the\\] \\*bold\\* snake\\_case \\`code\\` back\\\\slash — Todo",
    )
    expect(markdown).toContain("- [ ] WEB-1 Two lines — Todo")
  })

  test("the year is shown on dates outside the week's year", () => {
    const markdown = weekLogMarkdown(
      {
        people: [
          {
            user: { name: "Ada" },
            member: true,
            tasks: [
              task({ assignedAt: new Date(2026, 11, 20, 10).toISOString(), carriedOver: true }),
            ],
          },
        ],
      },
      { week: "2027-01-04", now: NOW },
    )
    expect(markdown).toContain("# Weekly log · Jan 4 – 10, 2027")
    expect(markdown).toContain("carried over, assigned Sun, Dec 20, 2026")
  })

  test("a completed task without a completion time falls back to its status", () => {
    const markdown = weekLogMarkdown(
      { people: [{ user: { name: "Ada" }, member: true, tasks: [task({ status: "complete" })] }] },
      { week: WEEK, now: NOW },
    )
    expect(markdown).toContain("- [x] WEB-1 Task — Complete · assigned Mon, Oct 12")
  })

  test("urls with parentheses or spaces keep the link intact", () => {
    const markdown = weekLogMarkdown(
      { people: [{ user: { name: "Ada" }, member: true, tasks: [task()] }] },
      { week: WEEK, taskUrl: () => "https://x.test/a b/(c)", now: NOW },
    )
    expect(markdown).toContain("[WEB-1](https://x.test/a%20b/%28c%29)")
  })

  const opts = {
    week: WEEK,
    workspace: "Acme",
    taskUrl: (t: WeekTaskInput) => `https://intesa.test/t/${t.key}`,
    now: NOW,
  }

  test("simple Markdown keeps to what Slack also reads", () => {
    expect(weekLogSimpleMarkdown(log, opts)).toBe(
      [
        "*Weekly log · Oct 12 – 18, 2026*",
        "",
        "Acme · 1 completed · 2 pending",
        "",
        "*Ada Lovelace* · 1 completed · 2 pending",
        "",
        "_Completed_",
        "- WEB-12 Fix login redirect — completed Wed, Oct 14 · assigned Mon, Oct 12",
        "",
        "_Pending_",
        "- WEB-15 Add CSV export — In progress · carried over, assigned Fri, Oct 2",
        "- API-3 Rate limit — Todo · assigned Thu, Oct 15 · unassigned Fri, Oct 16",
        "",
        "*Nothing this week:* Grace Hopper",
        "",
      ].join("\n"),
    )
  })

  test("simple Markdown leaves titles as written", () => {
    const text = weekLogSimpleMarkdown(
      {
        people: [
          {
            user: { name: "Ada" },
            member: true,
            tasks: [task({ title: "Fix *all* [the]\nbugs" })],
          },
        ],
      },
      opts,
    )
    expect(text).toContain("- WEB-1 Fix *all* [the] bugs — ")
  })

  test("rich text is HTML with links, and escapes what it is given", () => {
    const html = weekLogHtml(
      {
        people: [
          ...log.people,
          { user: { name: "Bo <b>" }, member: true, tasks: [task({ title: 'A & "B" <i>' })] },
        ],
      },
      opts,
    )
    expect(html).toStartWith("<h2>Weekly log · Oct 12 – 18, 2026</h2>\n")
    expect(html).toContain("<h3>Ada Lovelace</h3>")
    expect(html).toContain(
      '<li><a href="https://intesa.test/t/WEB-12">WEB-12</a> Fix login redirect <span style="color:#6b7280">— completed Wed, Oct 14 · assigned Mon, Oct 12</span></li>',
    )
    expect(html).toContain("<p><strong>Pending</strong></p>")
    expect(html).toContain("<h3>Bo &lt;b&gt;</h3>")
    expect(html).toContain("A &amp; &quot;B&quot; &lt;i&gt;")
    expect(html).toContain("<p><strong>Nothing this week:</strong> Grace Hopper</p>")
  })
})
