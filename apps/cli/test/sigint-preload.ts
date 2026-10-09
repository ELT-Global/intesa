// Preloaded into a CLI run (bun --preload) to press Ctrl+C on any platform: a real keypress
// cannot be sent to a child in a pseudo-terminal on Windows. When the file named by
// INTESA_TEST_SIGINT_FILE appears it is deleted and SIGINT is raised in this process, where
// listeners receive it as they would a signal.
//
// A listener added once the CLI has started (so it runs after the CLI's own) writes
// INTESA_TEST_SIGINT_SEEN: it shows that exiting waits for the listeners that come later.
import { existsSync, rmSync, writeFileSync } from "node:fs"

const trigger = process.env.INTESA_TEST_SIGINT_FILE
const seen = process.env.INTESA_TEST_SIGINT_SEEN
if (trigger) {
  // Unref'd, so the run still ends when the CLI is done.
  setTimeout(() => {
    if (seen) process.on("SIGINT", () => writeFileSync(seen, "seen"))
  }, 50).unref()
  setInterval(() => {
    if (!existsSync(trigger)) return
    rmSync(trigger)
    process.emit("SIGINT")
  }, 20).unref()
}
