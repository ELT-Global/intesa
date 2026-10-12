#!/usr/bin/env node
// Entry point of the npm package. intesa runs on Bun: under Bun the bundle is loaded in this
// process; under Node (npm's shims always start node) it hands over to `bun` on the same
// terminal, or says how to get Bun.
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const bundle = new URL("../intesa.js", import.meta.url)

if (process.versions.bun) {
  await import(bundle.href)
} else {
  // Ctrl+C reaches both processes; bun decides what it means and its exit code is passed on.
  process.on("SIGINT", () => {})
  const run = spawnSync("bun", [fileURLToPath(bundle), ...process.argv.slice(2)], {
    stdio: "inherit",
  })
  if (run.error?.code === "ENOENT") {
    console.error(
      "intesa runs on Bun 1.4 or newer, which was not found on PATH.\n" +
        "Install it from https://bun.sh and run intesa again, or use a standalone binary from\n" +
        "https://github.com/ELT-Global/intesa/releases",
    )
    process.exit(1)
  }
  if (run.error) throw run.error
  process.exit(run.status ?? 1)
}
