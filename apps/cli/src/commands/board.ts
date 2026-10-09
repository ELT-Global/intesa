import { usageError } from "../output/errors"
import { defineCommand } from "../registry/define"

export default defineCommand({
  name: "board",
  summary: "Open a project's board full screen",
  description:
    "A full-screen board like the web project page: columns per status, a table view,\n" +
    "search, the assignee filter, and the same keys as the web where terminals allow.\n" +
    "Press ? on the board for every key.\n\n" +
    "KEY is a project key (WEB) or a task (WEB-12), which opens on the board. Without it\n" +
    "the project comes from -p, INTESA_PROJECT, .intesa.json or the config default.\n" +
    "Needs an interactive terminal; scripts use `intesa task list`.",
  args: [{ name: "key", description: "Project key like WEB, or a task like WEB-12" }],
  context: ["workspace", "project"],
  examples: ["intesa board", "intesa board WEB", "intesa board WEB-12"],
  async run(ctx, { key }) {
    // The board saves as you go and prints nothing to parse.
    if (ctx.globals.dryRun || ctx.globals.json) {
      const flag = ctx.globals.dryRun ? "--dry-run" : "--json"
      throw usageError(`board does not take ${flag}; use the \`intesa task\` commands`)
    }
    // OpenTUI would draw escape codes into a pipe rather than fail.
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw usageError("board needs an interactive terminal; use `intesa task list`")
    }
    const { runBoard } = await import("../tui/app")
    await runBoard(ctx, key)
  },
})
