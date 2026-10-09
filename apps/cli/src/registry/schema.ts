import { z } from "zod"
import { ERROR_CODES, EXIT_CODES } from "../output/errors"
import { FIELD_SETS } from "../output/render"
import { VERSION } from "../version"
import { type Command, globalFlags, kebab } from "./define"

type Prop = { type?: string; default?: unknown }

// JSON Schema for a flags object, keyed by the flags people type: `dry-run`, not `dryRun`,
// and `no-color` for a boolean that is on by default, matching help.
function flagsSchema(flags: z.ZodObject | undefined) {
  const { $schema: _, ...schema } = z.toJSONSchema(flags ?? z.object({}), {
    io: "input",
    unrepresentable: "any",
  }) as { $schema?: string; properties?: Record<string, Prop>; required?: string[] }
  if (schema.properties) {
    schema.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) =>
        v.type === "boolean" && v.default === true
          ? [`no-${kebab(k)}`, { ...v, default: false }]
          : [kebab(k), v],
      ),
    )
  }
  if (schema.required) schema.required = schema.required.map(kebab)
  return schema
}

export function commandSchema(cmd: Command, path: string[]) {
  return {
    command: ["intesa", ...path].join(" "),
    path,
    aliases: cmd.aliases ?? [],
    summary: cmd.summary,
    description: cmd.description ?? null,
    args: (cmd.args ?? []).map((a) => ({
      name: a.name,
      required: Boolean(a.required),
      variadic: Boolean(a.variadic),
      ...(a.enum ? { enum: a.enum } : {}),
      description: a.description ?? null,
    })),
    flags: flagsSchema(cmd.flags),
    context: cmd.context ?? [],
    output: cmd.output ? { name: cmd.output, fields: FIELD_SETS[cmd.output].fields } : null,
    examples: cmd.examples ?? [],
  }
}

export function cliSchema(commands: { cmd: Command; path: string[] }[]) {
  return {
    name: "intesa",
    version: VERSION,
    globalFlags: flagsSchema(globalFlags),
    exitCodes: EXIT_CODES,
    // The `code` of an `{"error": …}` on stderr, and the exit code that goes with it.
    errorCodes: ERROR_CODES,
    commands: commands.map(({ cmd, path }) => commandSchema(cmd, path)),
  }
}
