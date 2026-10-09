import { expect, test } from "bun:test"
import { openTuiImports } from "../scripts/opentui-imports"

// The bundle stands in its own module for @opentui/core, exporting the names the sources
// import from it. Any other way of importing the package would find members missing there.

test("the names imported from @opentui/core, types left out", () => {
  const names = openTuiImports([
    { path: "a.ts", text: 'import { RGBA, type TextChunk } from "@opentui/core"' },
    {
      path: "b.tsx",
      text: "import {\n  BoxRenderable,\n  RGBA as Colour,\n} from '@opentui/core'\nimport type { X } from \"@opentui/core\"",
    },
    { path: "c.ts", text: 'import { z } from "zod"' },
  ])
  expect(names.sort()).toEqual(["BoxRenderable", "RGBA"])
})

test.each([
  ["a namespace import", 'import * as tui from "@opentui/core"'],
  ["a default import", 'import tui from "@opentui/core"'],
  ["a default and named import", 'import tui, { RGBA } from "@opentui/core"'],
  ["a re-export", 'export { RGBA } from "@opentui/core"'],
  ["a star re-export", 'export * from "@opentui/core"'],
  ["a dynamic import", 'const m = await import("@opentui/core")'],
  ["a side-effect import", 'import "@opentui/core"'],
])("%s fails the build, naming the file", (_name, text) => {
  expect(() => openTuiImports([{ path: "src/tui/x.tsx", text }])).toThrow("src/tui/x.tsx")
})
