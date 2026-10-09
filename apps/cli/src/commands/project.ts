import { styleText } from "node:util"
import { STATUSES } from "@intesa/api/schemas"
import { STATUS_LABELS } from "@intesa/task-query"
import { z } from "zod"
import { writeLocalFile } from "../client/context"
import { links, resolver } from "../client/resolve"
import { readConfig, writeConfig } from "../config/config"
import { confirmDestructive } from "../output/ask"
import { usageError } from "../output/errors"
import { formatTable } from "../output/table"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"

type Project = { id: string; key: string; name: string; description: string | null }

async function withUrl<P extends Project>(ctx: Ctx, project: P) {
  const [{ host }, { slug }] = await Promise.all([ctx.http(), resolver(ctx).workspace()])
  return { ...project, url: links.project(host, slug, project.id) }
}

const keys = async (ctx: Ctx, { word }: { word: string }) =>
  (await resolver(ctx).projects()).map((p) => p.key).filter((k) => k.startsWith(word.toUpperCase()))

const keyArg = {
  name: "key",
  description: "Project key, e.g. WEB (default: the current project)",
  complete: keys,
}

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List the workspace's projects",
  context: ["workspace"],
  output: "project",
  examples: ["intesa project list", "intesa p list --json --fields key,name"],
  async run(ctx) {
    const projects = await resolver(ctx).projects()
    return Promise.all(projects.map((p) => withUrl(ctx, p)))
  },
})

type View = Awaited<ReturnType<typeof withUrl<Project>>> & {
  taskCounts: Record<string, number>
  customFields: { name: string; type: string; required: boolean; options: string[] }[]
}

function formatView(ctx: Ctx, view: View) {
  const table = { tty: ctx.mode.tty, width: ctx.mode.width, header: false }
  const heading = (text: string) => (ctx.mode.color ? styleText("bold", text) : text)
  const counts = STATUSES.map((s) => ({ status: STATUS_LABELS[s], n: view.taskCounts[s] ?? 0 }))
  const fields = view.customFields.map((f) => ({
    name: f.name,
    type: f.type,
    required: f.required ? "required" : "",
    options: f.options.join(", "),
  }))
  return [
    `${heading(`${view.name} (${view.key})`)}\n${view.url}\n`,
    ...(view.description ? [`${view.description}\n`] : []),
    `${heading("TASKS")}\n${formatTable(counts, ["status", "n"], table)}`,
    `${heading("CUSTOM FIELDS")}\n${
      fields.length ? formatTable(fields, ["name", "type", "required", "options"], table) : "None\n"
    }`,
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
  examples: ["intesa project view WEB", "intesa p view --json --fields key,taskCounts"],
  async run(ctx, { key }) {
    const r = resolver(ctx)
    const project = await r.project(key)
    const http = await ctx.http()
    const [tasksRes, customFields] = await Promise.all([
      http.client.api.projects[":projectId"].tasks.$get({ param: { projectId: project.id } }),
      r.fields(project.id),
    ])
    const taskCounts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]))
    for (const t of (await tasksRes.json()).tasks)
      taskCounts[t.status] = (taskCounts[t.status] ?? 0) + 1
    const result: View = { ...(await withUrl(ctx, project)), taskCounts, customFields }
    const { json, quiet, fields } = ctx.globals
    if (json || quiet || fields) return result
    ctx.stdout(formatView(ctx, result))
  },
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
    return withUrl(ctx, (await res.json()).project)
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
    return withUrl(ctx, (await res.json()).project)
  },
})

const remove = defineCommand({
  name: "delete",
  summary: "Delete a project and all of its tasks",
  description:
    "Delete a project together with its tasks, custom fields and artifacts (owners only).\n" +
    "Asks first on a terminal; otherwise --yes is required.",
  args: [{ name: "key", required: true, description: "Project key, e.g. WEB", complete: keys }],
  context: ["workspace"],
  examples: ["intesa project delete WEB", "intesa p delete WEB --yes"],
  async run(ctx, { key }) {
    const project = await resolver(ctx).project(key)
    await confirmDestructive(
      ctx,
      `Delete project ${project.key} (${project.name}) and all its tasks?`,
    )
    const http = await ctx.http()
    await http.client.api.projects[":projectId"].$delete({ param: { projectId: project.id } })
    ctx.stderr(`✓ Deleted project ${project.key}\n`)
    if (ctx.globals.json) return { id: project.id, key: project.key, deleted: true }
  },
})

const use = defineCommand({
  name: "use",
  summary: "Set the default project",
  description:
    "Make a project the default for later commands, in the user config. With --local it is\n" +
    "written to .intesa.json in the current directory instead.",
  args: [{ name: "key", required: true, description: "Project key, e.g. WEB", complete: keys }],
  flags: z.object({
    local: z
      .boolean()
      .default(false)
      .meta({ description: "Write .intesa.json in the current directory" }),
  }),
  context: ["workspace"],
  examples: ["intesa project use WEB", "intesa p use WEB --local"],
  async run(ctx, { key }, flags) {
    const project = await resolver(ctx).project(key)
    if (flags.local) {
      const path = writeLocalFile(ctx.cwd, { project: project.key })
      ctx.stderr(`✓ Using project ${project.key} in this directory (${path})\n`)
    } else {
      writeConfig(ctx.configDir, { ...readConfig(ctx.configDir), project: project.key })
      ctx.stderr(`✓ Default project set to ${project.key}\n`)
    }
    if (ctx.globals.json) return { project: project.key, id: project.id, local: flags.local }
  },
})

export default defineGroup({
  name: "project",
  aliases: ["p"],
  summary: "List, create and manage projects",
  commands: [list, view, create, edit, remove, use],
  examples: ["intesa project list", "intesa p view WEB", "intesa p use WEB --local"],
})
