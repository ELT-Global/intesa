import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { renderSkill, SKILL_DIR } from "../scripts/skill"
import { allCommands } from "../src/commands"

const read = (file: string) => readFileSync(join(SKILL_DIR, file), "utf8").replace(/\r\n/g, "\n")

// Front matter and body of a SKILL.md, split the way skill installers read it.
function parse(text: string) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!match) throw new Error("SKILL.md has no front matter")
  return {
    meta: Bun.YAML.parse(match[1] as string) as Record<string, unknown>,
    body: match[2] as string,
  }
}

describe("the intesa agent skill", () => {
  test("is generated and up to date with the commands", async () => {
    const files = await renderSkill()
    for (const [file, text] of Object.entries(files)) {
      if (!existsSync(join(SKILL_DIR, file)) || read(file) !== text) {
        throw new Error(`${file} is stale: run \`bun run --cwd apps/cli skill\` and commit it`)
      }
    }
    // Nothing else lies around in the skill that the generator no longer writes.
    const committed = readdirSync(SKILL_DIR, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) =>
        join(e.parentPath, e.name)
          .slice(SKILL_DIR.length + 1)
          .replaceAll("\\", "/"),
      )
    expect(committed.sort()).toEqual(Object.keys(files).sort())
  })

  // The Agent Skills rules that installers such as `npx skills add` validate.
  test("has valid front matter: a name matching its folder and a description that says when", () => {
    const { meta } = parse(read("SKILL.md"))
    expect(meta.name).toBe(basename(SKILL_DIR))
    expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(String(meta.name).length).toBeLessThanOrEqual(64)

    const description = String(meta.description)
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(description).toContain("Use when")

    expect(String(meta.compatibility).length).toBeLessThanOrEqual(500)
    // metadata is a map of strings to strings.
    for (const value of Object.values(meta.metadata as object)) expect(typeof value).toBe("string")
  })

  test("keeps SKILL.md short and its links one level deep and resolvable", () => {
    const { body } = parse(read("SKILL.md"))
    expect(body.split("\n").length).toBeLessThan(500)
    const links = [...body.matchAll(/\]\(([^)#]+)\)/g)]
      .map((m) => m[1] as string)
      .filter((href) => !/^https?:/.test(href))
    expect(links).toContain("references/commands.md")
    for (const href of links) {
      expect(href.split("/").length, href).toBeLessThanOrEqual(2)
      expect(existsSync(join(SKILL_DIR, href)), href).toBe(true)
    }
  })

  test("the reference lists every command with its usage", async () => {
    const reference = read("references/commands.md")
    for (const { cmd, path } of await allCommands()) {
      const line = reference.split("\n").find((l) => l.startsWith(`- \`intesa ${path.join(" ")}`))
      expect(line, `intesa ${path.join(" ")} is missing`).toBeDefined()
      expect(line).toContain(cmd.summary)
    }
  })
})
