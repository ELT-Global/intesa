import { mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"

// Every run starts from an empty database file.
export default function globalSetup() {
  const dir = resolve(import.meta.dirname, "../.e2e")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}
