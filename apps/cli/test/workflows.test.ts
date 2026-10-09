import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

// GitHub only reports a broken workflow file when it is pushed, so each one is parsed here.

const DIR = resolve(import.meta.dir, "../../../.github/workflows")
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))

test("there are workflows to check", () => {
  expect(files).toEqual(expect.arrayContaining(["ci.yml", "cli-release.yml"]))
})

test.each(files)("%s is valid YAML with triggers and jobs", (file) => {
  const workflow = Bun.YAML.parse(readFileSync(join(DIR, file), "utf8")) as Record<string, unknown>
  expect(workflow.on).toBeDefined()
  expect(Object.keys(workflow.jobs as object).length).toBeGreaterThan(0)
})
