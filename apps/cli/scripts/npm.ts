// Stages the npm package `intesa`: bun scripts/npm.ts [--outdir dist/npm]
//
// The package is the single-file bundle plus a launcher that runs it with Bun (npm's bin shims
// always start Node), the README written for npm and the licence. OpenTUI is an optional
// dependency so `intesa board` works where its native library installs. Publish the staged
// directory with: npm publish dist/npm --access public

import { cp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import pkg from "../package.json"

const root = join(import.meta.dir, "..")
const arg = process.argv.indexOf("--outdir")
const outdir = arg >= 0 ? (process.argv[arg + 1] as string) : join(root, "dist", "npm")

await rm(outdir, { recursive: true, force: true })
await mkdir(join(outdir, "bin"), { recursive: true })

const build = Bun.spawnSync(
  [process.execPath, join(root, "scripts", "build.ts"), "--outfile", join(outdir, "intesa.js")],
  { stdout: "inherit", stderr: "inherit" },
)
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1)

await cp(join(root, "npm", "bin", "intesa.js"), join(outdir, "bin", "intesa.js"))
await cp(join(root, "npm", "README.md"), join(outdir, "README.md"))
await cp(join(root, "LICENSE"), join(outdir, "LICENSE"))

const manifest = {
  name: "intesa",
  version: pkg.version,
  description:
    "Command-line client for Intesa, a project and task tracker, built for people and AI agents",
  keywords: ["intesa", "cli", "tasks", "project-management", "kanban", "mcp", "agents"],
  homepage: "https://github.com/ELT-Global/intesa#command-line-client",
  bugs: "https://github.com/ELT-Global/intesa/issues",
  repository: {
    type: "git",
    url: "git+https://github.com/ELT-Global/intesa.git",
    directory: "apps/cli",
  },
  license: "MIT",
  type: "module",
  bin: { intesa: "bin/intesa.js" },
  files: ["bin", "intesa.js"],
  engines: { bun: ">=1.4.2" },
  optionalDependencies: { "@opentui/core": pkg.dependencies["@opentui/core"] },
}
await Bun.write(join(outdir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`staged intesa@${pkg.version} in ${outdir}`)
