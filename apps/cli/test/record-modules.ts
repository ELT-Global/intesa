// Preloaded (`bun --preload`) by lazy.test.ts: at exit, writes the path of every module the
// run loaded to the file named by INTESA_TEST_MODULES.
import { writeFileSync } from "node:fs"

process.on("exit", () => {
  const file = process.env.INTESA_TEST_MODULES
  if (file) writeFileSync(file, Object.keys(require.cache).join("\n"))
})
