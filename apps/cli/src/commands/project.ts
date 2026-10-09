import { STATUSES } from "@intesa/api/schemas"
import { STATUS_LABELS } from "@intesa/task-query"
import { z } from "zod"
import { projectKeys } from "../client/candidates"
import { saveDefault } from "../client/context"
import { webLinks } from "../client/links"
import { resolver } from "../client/resolve"
import { confirmDestructive } from "../io/prompt"
import { usageError } from "../output/errors"
import { rows, section } from "../output/render"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"

const keyArg = {
  name: "key",
  description: "Project key, e.g. WEB (default: the current project)",
  complete: projectKeys,
}

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List the workspace's projects",
  context: ["workspace"],
  output: "project",
  examples: ["intesa project list", "intesa p list --json --fields key,name"],
  async run(ctx) {
    const [projects, link] = await Promise.all([resolver(ctx).projects(), webLinks(ctx)])
    return projects.map(link.project)
  },
})

type View = {
  name: string
  key: string
  url: string
  description: string | null
  taskCounts: Record<string, number>
  customFields: { name: string; type: string; required: boolean; options: string[] }[]
}

function formatView(ctx: Ctx, view: View) {
  const { mode } = ctx
  const counts = STATUSES.map((s) => ({ status: STATUS_LABELS[s], n: view.taskCounts[s] ?? 0 }))
  const fields = view.customFields.map((f) => ({
    name: f.name,
    type: f.type,
    required: f.required ? "required" : "",
    options: f.options.join(", "),
  }))
  return [
    section(mode, `${view.name} (${view.key})`, `${view.url}\n`),
    ...(view.description ? [`${view.description}\n`] : []),
    section(mode, "TASKS", rows(mode, counts, ["status", "n"])),
    section(
      mode,
      "CUSTOM FIELDS",
      fields.length ? rows(mode, fields, ["name", "type", "required", "options"]) : "None\n",
    ),
  ].join("\n")
}

const view = defineCommand({
  name: "view",
  summary: "Show a project",
  description:
    "Show a project: its description, how many top-level tasks are in each status (the board\n" +
    "columns) and its custom field definitions.",
  args: [keyArg],
  context: ["workspace", "project"],
  output: "projectView",
  paged: true,
  examples: ["intesa project view WEB", "intesa p view --json --fields key,taskCounts"],
  async run(ctx, { key }) {
    const r = resolver(ctx)
    const project = await r.project(key)
    const http = await ctx.http()
    const [tasksRes, customFields, link] = await Promise.all([
      http.client.api.projects[":projectId"].tasks.$get({ param: { projectId: project.id } }),
      r.fields(project.id),
      webLinks(ctx),
    ])
    const taskCounts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]))
    for (const t of (await tasksRes.json()).tasks)
      taskCounts[t.status] = (taskCounts[t.status] ?? 0) + 1
    return { ...link.project(project), taskCounts, customFields }
  },
  human: formatView,
})

const create = defineCommand({
  name: "create",
  summary: "Create a project",
  description:
    "Create a project in the current workspace. Its key (the WEB in WEB-12) is derived from\n" +
    "the name unless --key is given.",
  args: [{ name: "name", required: true }],
  flags: z.object({
    key: z
      .string()
      .optional()
      .meta({ placeholder: "KEY", description: "2-5 letters or digits, starting with a letter" }),
    description: z.string().optional().meta({ placeholder: "text", description: "Description" }),
  }),
  context: ["workspace"],
  output: "project",
  examples: ['intesa project create "Website Redesign"', "intesa p create Web --key WEB"],
  async run(ctx, { name }, flags) {
    const http = await ctx.http()
    const { id } = await resolver(ctx).workspace()
    const res = await http.client.api.workspaces[":workspaceId"].projects.$post({
      param: { workspaceId: id },
      json: { name, key: flags.key?.toUpperCase(), description: flags.description },
    })
    return (await webLinks(ctx)).project((await res.json()).project)
  },
})

const edit = defineCommand({
  name: "edit",
  summary: "Rename a project or change its description",
  args: [keyArg],
  flags: z.object({
    name: z.string().optional().meta({ placeholder: "name", description: "New name" }),
    description: z
      .string()
      .nullable()
      .optional()
      .meta({ placeholder: "text", description: "New description; --no-description clears it" }),
  }),
  context: ["workspace", "project"],
  output: "project",
  examples: ['intesa project edit WEB --name "Website"', "intesa p edit WEB --no-description"],
  async run(ctx, { key }, flags) {
    if (flags.name === undefined && flags.description === undefined) {
      throw usageError("nothing to change: pass --name, --description or --no-description")
    }
    const project = await resolver(ctx).project(key)
    const http = await ctx.http()
    const res = await http.client.api.projects[":projectId"].$patch({
      param: { projectId: project.id },
      json: { name: flags.name, description: flags.description },
    })
    return (await webLinks(ctx)).project((await res.json()).project)
  },
})

const remove = defineCommand({
  name: "delete",
  summary: "Delete a project and all of its tasks",
  description:
    "Delete a project together with its tasks, custom fields and artifacts (owners only).\n" +
    "Asks first on a terminal; otherwise --yes is required.",
  args: [
    { name: "key", required: true, description: "Project key, e.g. WEB", complete: projectKeys },
  ],
  context: ["workspace"],
  output: "deleted",
  examples: ["intesa project delete WEB", "intesa p delete WEB --yes"],
  async run(ctx, { key }) {
    const project = await resolver(ctx).project(key)
    await confirmDestructive(
      ctx,
      `Delete project ${project.key} (${project.name}) and all its tasks?`,
    )
    const http = await ctx.http()
    await http.client.api.projects[":projectId"].$delete({ param: { projectId: project.id } })
    ctx.done(`Deleted project ${project.key}`)
    return { id: project.id, key: project.key, deleted: true }
  },
  human: () => "",
})

const use = defineCommand({
  name: "use",
  summary: "Set the default project",
  description:
    "Make a project the default for later commands, in the user config. With --local it is\n" +
    "written to .intesa.json in the current directory instead.",
  args: [
    { name: "key", required: true, description: "Project key, e.g. WEB", complete: projectKeys },
  ],
  flags: z.object({
    local: z
      .boolean()
      .default(false)
      .meta({ description: "Write .intesa.json in the current directory" }),
  }),
  context: ["workspace"],
  output: "projectDefault",
  examples: ["intesa project use WEB", "intesa p use WEB --local"],
  async run(ctx, { key }, flags) {
    const project = await resolver(ctx).project(key)
    const file = saveDefault(ctx, "project", project.key, flags.local)
    ctx.done(
      flags.local
        ? `Using project ${project.key} in this directory (${file})`
        : `Default project set to ${project.key}`,
    )
    return { id: project.id, key: project.key, file }
  },
  human: () => "",
})

export default defineGroup({
  name: "project",
  aliases: ["p"],
  summary: "List, create and manage projects",
  commands: [list, view, create, edit, remove, use],
  examples: ["intesa project list", "intesa p view WEB", "intesa p use WEB --local"],
})
