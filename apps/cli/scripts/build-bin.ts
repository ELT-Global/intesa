// Builds the standalone `intesa` executables: bun scripts/build-bin.ts [--target <name>]...
//
// Without --target it builds every target; with one or more (repeatable, "windows-x64" or
// "bun-windows-x64") only those. Output goes to dist/intesa-<target>[.exe].
//
// Cross-compiling needs the native OpenTUI library of every platform installed:
//   bun install --os="*" --cpu="*"
// Without that, only the host platform's target links the TUI correctly.
//
// --bytecode is deliberately absent: OpenTUI uses top-level await, which bytecode output rejects.

import { mkdirSync } from "node:fs"
import { join } from "node:path"

const TARGETS = ["windows-x64", "linux-x64", "linux-arm64", "darwin-arm64"] as const

const root = join(import.meta.dir, "..")
const dist = join(root, "dist")

function selectedTargets(argv: string[]): string[] {
  const wanted: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === "--target") wanted.push(argv[++i] ?? "")
    else if (arg.startsWith("--target=")) wanted.push(arg.slice("--target=".length))
    else throw new Error(`Unknown argument ${arg}`)
  }
  if (wanted.length === 0) return [...TARGETS]
  return wanted.map((raw) => {
    const name = raw.replace(/^bun-/, "")
    if (!(TARGETS as readonly string[]).includes(name)) {
      throw new Error(`Unknown target ${raw}; expected one of ${TARGETS.join(", ")}`)
    }
    return name
  })
}

mkdirSync(dist, { recursive: true })

for (const target of selectedTargets(process.argv.slice(2))) {
  const outfile = join(dist, `intesa-${target}${target.startsWith("windows") ? ".exe" : ""}`)
  console.log(`Building ${outfile}`)
  const build = Bun.spawnSync(
    [
      process.execPath,
      "build",
      "src/main.ts",
      "--compile",
      "--minify",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      `--target=bun-${target}`,
      "--outfile",
      outfile,
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  )
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1)
}
