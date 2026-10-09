import { usageError } from "../output/errors"
import { toJson } from "../output/json"
import { defineCommand } from "../registry/define"
import { cliSchema } from "../registry/schema"
import { allCommands } from "."

export default defineCommand({
  name: "schema",
  summary: "Describe commands, flags and exit codes as JSON",
  description:
    "Print a JSON description of intesa's commands for agents and tooling: arguments, flags\n" +
    "(as JSON Schema), output fields, global flags and exit codes. Name a command or a\n" +
    "command group to describe only that part.",
  args: [{ name: "command", variadic: true, description: "Command words, e.g. `config set`" }],
  examples: ["intesa schema", "intesa schema api", "intesa schema config set"],
  async run(ctx, { command }) {
    const all = await allCommands()
    const selected = all.filter((c) => command.every((word, i) => c.names[i]?.includes(word)))
    if (selected.length === 0) throw usageError(`unknown command "${command.join(" ")}"`)
    ctx.stdout(toJson(cliSchema(selected)))
  },
})
