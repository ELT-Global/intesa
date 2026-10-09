import { FIELD_TYPES } from "@intesa/api/schemas"
import { z } from "zod"
import { resolver } from "../client/resolve"
import { confirmDestructive } from "../io/prompt"
import { usageError } from "../output/errors"
import { wordsStarting } from "../registry/completion"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"

const fieldArg = {
  name: "field",
  required: true,
  description: "Field name (any case) or id",
  complete: async (ctx: Ctx, { word }: { word: string }) => {
    const r = resolver(ctx)
    const fields = await r.fields((await r.project()).id)
    return wordsStarting(
      fields.map((f) => f.name),
      word,
    )
  },
} as const

// The server trims options too; doing it here keeps comparisons with stored options exact.
const trimmed = (values: string[] | undefined) => (values ?? []).map((v) => v.trim())
const quoted = (values: string[]) => values.map((v) => `"${v}"`).join(", ")

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List a project's custom fields",
  context: ["workspace", "project"],
  output: "field",
  examples: ["intesa field list -p WEB", "intesa field list --json --fields name,type,options"],
  async run(ctx) {
    const r = resolver(ctx)
    return r.fields((await r.project()).id)
  },
})

const create = defineCommand({
  name: "create",
  summary: "Add a custom field to a project",
  description:
    "Add a custom field that tasks in the project can hold a value for. Names are unique in\n" +
    "a project, ignoring case. A select field needs its choices as --option, in the order\n" +
    "they should appear. Required means a value, once set, cannot be cleared.",
  args: [{ name: "name", required: true }],
  flags: z.object({
    type: z.enum(FIELD_TYPES).meta({ placeholder: "type", description: "What the field holds" }),
    option: z
      .array(z.string())
      .optional()
      .meta({ placeholder: "choice", description: "A choice of a select field; repeat for more" }),
    required: z.boolean().default(false).meta({ description: "Values cannot be cleared once set" }),
  }),
  context: ["workspace", "project"],
  output: "field",
  examples: [
    "intesa field create Estimate --type number -p WEB",
    "intesa field create Stage --type select --option Alpha --option Beta --required",
  ],
  async run(ctx, { name }, flags) {
    const options = trimmed(flags.option)
    if (flags.type === "select" && options.length === 0) {
      throw usageError("a select field needs at least one --option")
    }
    if (flags.type !== "select" && options.length > 0) {
      throw usageError("--option only applies to --type select")
    }
    const r = resolver(ctx)
    const project = await r.project()
    const http = await ctx.http()
    const res = await http.client.api.projects[":projectId"]["custom-fields"].$post({
      param: { projectId: project.id },
      json: {
        name,
        type: flags.type,
        required: flags.required,
        options: options.length ? options : undefined,
      },
    })
    return (await res.json()).field
  },
})

const edit = defineCommand({
  name: "edit",
  summary: "Rename a custom field or change its options",
  description:
    "Rename a field, make it required or optional, or change the choices of a select field.\n" +
    "Removing a choice clears that value on every task that had it. A field's type cannot\n" +
    "change.",
  args: [fieldArg],
  flags: z.object({
    name: z.string().optional().meta({ placeholder: "name", description: "New name" }),
    required: z
      .boolean()
      .optional()
      .meta({ description: "Values cannot be cleared once set; --no-required lifts that" }),
    addOption: z
      .array(z.string())
      .optional()
      .meta({ placeholder: "choice", description: "Add a choice to a select field" }),
    removeOption: z
      .array(z.string())
      .optional()
      .meta({ placeholder: "choice", description: "Remove a choice, clearing it from tasks" }),
  }),
  context: ["workspace", "project"],
  output: "field",
  examples: [
    'intesa field edit Stage --add-option "Release candidate"',
    "intesa field edit Stage --remove-option Alpha",
    "intesa field edit Estimate --required",
  ],
  async run(ctx, { field: ref }, flags) {
    const adds = trimmed(flags.addOption)
    const removes = trimmed(flags.removeOption)
    const changesOptions = adds.length > 0 || removes.length > 0
    if (flags.name === undefined && flags.required === undefined && !changesOptions) {
      throw usageError(
        "nothing to change: pass --name, --required, --no-required, --add-option or --remove-option",
      )
    }
    const r = resolver(ctx)
    const field = await r.field((await r.project()).id, ref)
    let options: string[] | undefined
    if (changesOptions) {
      if (field.type !== "select") {
        throw usageError(`${field.name} is a ${field.type} field: only select fields have options`)
      }
      // A typo would otherwise silently do nothing, so unknown choices are an error.
      const unknown = removes.filter((o) => !field.options.includes(o))
      if (unknown.length) {
        throw usageError(
          `${field.name} has no option ${quoted(unknown)}`,
          `Its options: ${field.options.join(", ")}`,
        )
      }
      const kept = field.options.filter((o) => !removes.includes(o))
      options = [...kept, ...new Set(adds.filter((o) => !kept.includes(o)))]
    }
    const http = await ctx.http()
    const res = await http.client.api["custom-fields"][":fieldId"].$patch({
      param: { fieldId: field.id },
      json: { name: flags.name, required: flags.required, options },
    })
    if (removes.length) {
      ctx.stderr(
        `warning: tasks that had ${quoted(removes)} in ${field.name} no longer have a value\n`,
      )
    }
    return (await res.json()).field
  },
})

const remove = defineCommand({
  name: "delete",
  summary: "Delete a custom field and its values",
  description:
    "Delete a custom field together with the values tasks hold for it. Asks first on a\n" +
    "terminal; otherwise --yes is required.",
  args: [fieldArg],
  context: ["workspace", "project"],
  output: "deleted",
  examples: ["intesa field delete Estimate -p WEB", "intesa field delete Estimate --yes"],
  async run(ctx, { field: ref }) {
    const r = resolver(ctx)
    const field = await r.field((await r.project()).id, ref)
    await confirmDestructive(ctx, `Delete field ${field.name} and its values on all tasks?`)
    const http = await ctx.http()
    await http.client.api["custom-fields"][":fieldId"].$delete({ param: { fieldId: field.id } })
    ctx.done(`Deleted field ${field.name}`)
    return { id: field.id, name: field.name, deleted: true }
  },
  human: () => "",
})

export default defineGroup({
  name: "field",
  summary: "List, create and manage a project's custom fields",
  commands: [list, create, edit, remove],
  examples: ["intesa field list -p WEB", "intesa field create Estimate --type number -p WEB"],
})
