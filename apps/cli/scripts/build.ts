// Builds the single-file bundle: bun scripts/build.ts [--outfile dist/intesa.js]
//
// The bundle runs on any machine with Bun, so it cannot carry OpenTUI's native library.
// `intesa board` is the only user, and it is loaded on demand, but a bundler hoists the static
// imports of a lazily loaded module to the top of the file, which would make every command
// fail where @opentui/core is not installed. The plugin below swaps those imports for a module
// that loads the package when `board` first needs it, with a clear error when it is missing.

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const root = join(import.meta.dir, "..")

const arg = process.argv.indexOf("--outfile")
const outfile = arg >= 0 ? (process.argv[arg + 1] as string) : join(root, "dist", "intesa.js")

// The names the sources import from the package, read from the sources so that building does
// not need to load the native library (which a build on another libc could not).
function importedNames(): string[] {
  const names = new Set<string>()
  const statement = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@opentui\/core["']/g
  for (const file of new Bun.Glob("**/*.ts").scanSync(join(root, "src"))) {
    for (const match of readFileSync(join(root, "src", file), "utf8").matchAll(statement)) {
      for (const part of (match[1] as string).split(",")) {
        const spec = part.trim()
        if (spec && !spec.startsWith("type "))
          names.add((spec.split(/\s+as\s+/)[0] as string).trim())
      }
    }
  }
  return [...names]
}

const NAMES = importedNames()

const LAZY_OPENTUI = `
const NAME = ["@opentui", "core"].join("/")
let m
try {
  m = await import(NAME)
} catch {
  throw new Error(
    "intesa board needs @opentui/core, which is not installed here. Use the standalone " +
    "binary, or install it next to this file: bun add @opentui/core@${
      (await Bun.file(join(root, "package.json")).json()).dependencies["@opentui/core"]
    }",
  )
}
${NAMES.map((name) => `export const ${name} = m.${name}`).join("\n")}
`

const result = await Bun.build({
  entrypoints: [join(root, "src", "main.ts")],
  outdir: dirname(outfile),
  naming: outfile.slice(dirname(outfile).length + 1),
  target: "bun",
  minify: true,
  plugins: [
    {
      name: "lazy-opentui",
      setup(build) {
        build.onResolve({ filter: /^@opentui\/core$/ }, () => ({
          path: "lazy-opentui",
          namespace: "lazy-opentui",
        }))
        build.onLoad({ filter: /.*/, namespace: "lazy-opentui" }, () => ({
          contents: LAZY_OPENTUI,
          loader: "js",
        }))
      },
    },
  ],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
const output = result.outputs[0] as { size: number }
console.log(`${outfile} ${(output.size / 1024).toFixed(0)} KB`)
