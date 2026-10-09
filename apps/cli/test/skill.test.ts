import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { renderSkill, SKILL_PATH } from "../scripts/skill"
import { allCommands } from "../src/commands"

describe("SKILL.md", () => {
  test("is the generated file, up to date with the commands", async () => {
    const committed = readFileSync(SKILL_PATH, "utf8").replace(/\r\n/g, "\n")
    if (committed !== (await renderSkill())) {
      throw new Error("SKILL.md is stale: run `bun run --cwd apps/cli skill` and commit it")
    }
  })

  test("starts with the front matter an agent uses to find the skill", async () => {
    const text = await renderSkill()
    const match = /^---\nname: intesa\ndescription: (.+)\n---\n/.exec(text)
    expect(match?.[1]).toContain("Use when")
  })

  test("lists every command with its usage", async () => {
    const text = await renderSkill()
    for (const { cmd, path } of await allCommands()) {
      const line = text.split("\n").find((l) => l.startsWith(`- \`intesa ${path.join(" ")}`))
      expect(line, `intesa ${path.join(" ")} is missing`).toBeDefined()
      expect(line).toContain(cmd.summary)
    }
  })

  test("stays short enough to be read in full", async () => {
    expect((await renderSkill()).split("\n").length).toBeLessThan(400)
  })
})
