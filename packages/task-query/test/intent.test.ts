import { describe, expect, test } from "bun:test"
import { INTENT_HUES, intentHue, titleIntent } from "../src"

describe("titleIntent", () => {
  test("splits the type and scope off the rest of the title", () => {
    expect(titleIntent("feat(iii/admin): organise > educators")).toEqual({
      type: "feat",
      scope: "iii/admin",
      prefix: "feat(iii/admin):",
      rest: " organise > educators",
      hue: "green",
    })
  })

  test("the scope is optional, may hold spaces, and a breaking mark stays in the prefix", () => {
    expect(titleIntent("fix: invalid nginx config")?.prefix).toBe("fix:")
    expect(titleIntent("fix: invalid nginx config")?.scope).toBeNull()
    expect(titleIntent("feat(doubt room): admin side closing")?.scope).toBe("doubt room")
    expect(titleIntent("refactor(api)!: drop v1")?.prefix).toBe("refactor(api)!:")
  })

  test("titles not written that way have no intent", () => {
    for (const title of [
      "Fix Fee policy + Batch Fee",
      "refactor ai-evalution flow",
      "Note: ask about invoices",
      "http://example.com is down",
      "fix:no space after the colon",
      "feat(unclosed: scope",
      "",
    ]) {
      expect(titleIntent(title)).toBeNull()
    }
  })
})

describe("intentHue", () => {
  test("the usual types each get their own colour", () => {
    const types = ["feat", "fix", "docs", "refactor", "perf", "style", "test", "build", "ci"]
    const hues = types.map(intentHue)
    expect(new Set([...hues, intentHue("chore"), intentHue("revert")]).size).toBe(types.length + 2)
  })

  test("any other type gets the same colour every time", () => {
    expect(intentHue("spike")).toBe(intentHue("spike"))
    expect(INTENT_HUES).toContain(intentHue("spike"))
  })
})
