import { describe, expect, test } from "bun:test"
import { browserCommand } from "../src/io/browser"
import { project, selectFields } from "../src/output/json"
import { formatTable } from "../src/output/table"

describe("browserCommand", () => {
  const url = "https://pm.example.com/w/acme/home?a=1&b=2"

  test("BROWSER may be a quoted path with spaces, plus arguments", () => {
    const env = { BROWSER: '"C:\\Program Files\\Google\\chrome.exe" --new-window' }
    expect(browserCommand(url, { env, platform: "win32" })).toEqual([
      "C:\\Program Files\\Google\\chrome.exe",
      "--new-window",
      url,
    ])
  })

  test("otherwise the platform's opener, which takes the URL as one argument", () => {
    expect(browserCommand(url, { env: {}, platform: "win32" })).toEqual([
      "rundll32",
      "url.dll,FileProtocolHandler",
      url,
    ])
    expect(browserCommand(url, { env: {}, configBrowser: "firefox", platform: "linux" })).toEqual([
      "firefox",
      url,
    ])
  })
})

describe("formatTable", () => {
  const rows = [
    { key: "WEB-1", title: "世界 wide glyphs", tags: ["auth", "bug"], due: null },
    { key: "WEB-10", title: "Fix\tlogin\nredirect", tags: [], due: "2026-10-15" },
  ]

  test("piped output is TSV: no header, no truncation, stable columns", () => {
    const out = formatTable(rows, ["key", "title", "tags", "due"], { tty: false, width: 10 })
    expect(out).toBe(
      "WEB-1\t世界 wide glyphs\tauth,bug\t\nWEB-10\tFix login redirect\t\t2026-10-15\n",
    )
  })

  test("terminal output aligns columns by display width under a header", () => {
    const out = formatTable(
      [
        { key: "WEB-1", title: "世界" },
        { key: "WEB-10", title: "ab" },
      ],
      ["key", "title"],
      { tty: true, width: 80 },
    )
    expect(out).toBe("KEY     TITLE\nWEB-1   世界\nWEB-10  ab\n")
  })

  test("terminal output shrinks the widest column to fit, with an ellipsis", () => {
    const long = { key: "WEB-1", title: "A very long task title that cannot fit", status: "todo" }
    const out = formatTable([long], ["key", "title", "status"], { tty: true, width: 30 })
    const lines = out.trimEnd().split("\n")
    for (const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(30)
    expect(lines[1]).toStartWith("WEB-1  A very")
    expect(lines[1]).toContain("…")
    expect(lines[1]).toEndWith("todo")
  })

  test("no rows, no output", () => {
    expect(formatTable([], ["key"], { tty: true, width: 80 })).toBe("")
  })

  test("people, tags and other named things show as their names", () => {
    const row = {
      assignees: [
        { id: "u1", name: "Alan Owner" },
        { id: "u2", name: "Mei" },
      ],
      project: { id: "p1", name: "Web" },
      counts: { todo: 2 },
    }
    expect(formatTable([row], ["assignees", "project", "counts"], { tty: false, width: 80 })).toBe(
      'Alan Owner,Mei\tWeb\t{"todo":2}\n',
    )
  })
})

describe("--fields", () => {
  test("projects arrays and objects in the requested order, missing fields as null", () => {
    const rows = [
      { id: "1", key: "WEB-1", title: "A" },
      { id: "2", key: "WEB-2" },
    ]
    expect(project(rows, ["title", "key"])).toEqual([
      { title: "A", key: "WEB-1" },
      { title: null, key: "WEB-2" },
    ])
    expect(project({ id: "1", key: "WEB-1" }, ["key"])).toEqual({ key: "WEB-1" })
    expect(project(rows, undefined)).toBe(rows)
  })

  test("parses a comma list and checks it against the command's field set", () => {
    expect(selectFields(" key, title ,", ["key", "title", "status"])).toEqual(["key", "title"])
    expect(selectFields(undefined, ["key"])).toBeUndefined()
    expect(selectFields("anything", undefined)).toEqual(["anything"])
    expect(() => selectFields("key,nope", ["key", "title"])).toThrow(
      'unknown field "nope" (available: key, title)',
    )
  })
})
