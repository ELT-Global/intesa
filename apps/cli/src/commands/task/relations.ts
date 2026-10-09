import { z } from "zod"
import { webLinks } from "../../client/links"
import { resolver } from "../../client/resolve"
import { openOrPrint } from "../../io/browser"
import { notFound, usageError } from "../../output/errors"
import { asTable, rows, section } from "../../output/render"
import { statusText } from "../../output/task-line"
import { type Ctx, defineCommand } from "../../registry/define"
import { historyRows, lineStyle, relationRows, type TaskDetail, taskArg, taskKeys } from "./shared"

const context = ["workspace", "project"] as const

// How each relationship is typed on the command line, sent to the API and listed on a task.
const RELATIONS = [
  { flag: "blocks", type: "blocks", field: "blocks", verb: "blocks" },
  { flag: "blocked-by", type: "blocked_by", field: "blockedBy", verb: "is blocked by" },
  { flag: "related", type: "related", field: "related", verb: "is related to" },
] as const
type Relation = (typeof RELATIONS)[number]

const otherArg = {
  name: "other",
  required: true,
  description: "The other task, named like TASK",
  complete: taskKeys,
} as const

// The task's relationships after a change, as the task panel lists them.
function showRelations(ctx: Ctx, task: TaskDetail) {
  const list = relationRows(ctx, task)
  return list ? section(ctx.mode, `${task.key} relationships`, list) : ""
}

async function withUrl(ctx: Ctx, task: TaskDetail) {
  return (await webLinks(ctx, task.project.workspaceId)).task(task)
}

export const history = defineCommand({
  name: "history",
  summary: "Show a task's status changes",
  description:
    "List every status change of a task, oldest first: when, who, and from what to what.",
  args: [taskArg],
  context,
  output: "taskHistory",
  examples: ["intesa task history WEB-12", "intesa task history WEB-12 --json"],
  async run(ctx, { task: ref }) {
    const task = await resolver(ctx).task(ref)
    const { client } = await ctx.http()
    const res = await client.api.tasks[":taskId"].history.$get({ param: { taskId: task.id } })
    return (await res.json()).history
  },
  human: historyRows,
})

export const link = defineCommand({
  name: "link",
  summary: "Link two tasks: one blocks the other, or they are related",
  description:
    "Add a relationship between two tasks of the workspace, as the task panel does.\n" +
    "--blocks: TASK blocks OTHER. --blocked-by: OTHER blocks TASK. --related: they are\n" +
    "related, both ways. A link that exists already, or blocks that would go round in a\n" +
    "circle, exit 6.",
  args: [taskArg, otherArg],
  flags: z.object({
    blocks: z.boolean().default(false).meta({ description: "TASK blocks OTHER" }),
    blockedBy: z.boolean().default(false).meta({ description: "OTHER blocks TASK" }),
    related: z.boolean().default(false).meta({ description: "TASK and OTHER are related" }),
  }),
  context,
  output: "taskDetail",
  examples: [
    "intesa task link WEB-12 --blocks WEB-14",
    "intesa task link WEB-12 --blocked-by API-3",
    "intesa task link WEB-12 --related WEB-7",
  ],
  async run(ctx, { task: ref, other: otherRef }, flags) {
    const picked = RELATIONS.filter((r) =>
      r.flag === "blocks" ? flags.blocks : r.flag === "related" ? flags.related : flags.blockedBy,
    )
    const [relation] = picked
    if (!relation || picked.length > 1) {
      throw usageError("pass one of --blocks, --blocked-by or --related")
    }
    const r = resolver(ctx)
    const task = await r.task(ref)
    const other = await r.task(otherRef)
    const { client } = await ctx.http()
    const res = await client.api.tasks[":taskId"].relationships.$post({
      param: { taskId: task.id },
      json: { type: relation.type, taskId: other.id },
    })
    ctx.done(`${task.key} ${relation.verb} ${other.key}`)
    return withUrl(ctx, (await res.json()).task)
  },
  human: showRelations,
})

export const unlink = defineCommand({
  name: "unlink",
  summary: "Remove a relationship between two tasks",
  description:
    "Remove the relationship between two tasks, in whichever direction it was made. When\n" +
    "they are linked in more than one way, --type says which link to remove (exit 2\n" +
    "otherwise). Tasks that are not linked exit 5.",
  args: [taskArg, otherArg],
  flags: z.object({
    type: z
      .enum(RELATIONS.map((r) => r.flag) as [Relation["flag"], ...Relation["flag"][]])
      .optional()
      .meta({ placeholder: "type", description: "The link to remove, seen from TASK" }),
  }),
  context,
  output: "taskDetail",
  examples: ["intesa task unlink WEB-12 WEB-14", "intesa task unlink WEB-12 WEB-7 --type related"],
  async run(ctx, { task: ref, other: otherRef }, flags) {
    const r = resolver(ctx)
    const task = await r.task(ref)
    const other = await r.task(otherRef)
    const between = RELATIONS.filter((rel) => task[rel.field].some((t) => t.id === other.id))
    let relation = RELATIONS.find((rel) => rel.flag === flags.type)
    if (!relation) {
      if (between.length === 0) throw notFound(`${task.key} and ${other.key} are not linked`)
      if (between.length > 1) {
        throw usageError(
          `${task.key} and ${other.key} are linked more than one way (${between.map((b) => b.flag).join(", ")}): pass --type`,
        )
      }
      relation = between[0] as Relation
    }
    const { client } = await ctx.http()
    const res = await client.api.tasks[":taskId"].relationships[":otherTaskId"].$delete({
      param: { taskId: task.id, otherTaskId: other.id },
      query: { type: relation.type },
    })
    ctx.done(`${task.key} no longer ${relation.verb.replace(/^is /, "")} ${other.key}`)
    return withUrl(ctx, (await res.json()).task)
  },
  human: showRelations,
})

export const search = defineCommand({
  name: "search",
  summary: "Find tasks in the workspace by title or key",
  description:
    "Search every project of the workspace for tasks whose title or key contains QUERY, in\n" +
    "any case, as the web's task picker does. Subtasks and completed tasks are included;\n" +
    "the 20 most recently changed matches are listed. To filter one project's tasks with\n" +
    "the search syntax, use `task list -Q`.",
  args: [
    { name: "query", required: true, variadic: true, description: "Words of a title or a key" },
  ],
  context: ["workspace"],
  output: "taskRef",
  examples: [
    "intesa task search login redirect",
    "intesa task search WEB-1",
    "intesa task search auth --json --fields key,title",
  ],
  async run(ctx, { query }) {
    const { id } = await resolver(ctx).workspace()
    const { client } = await ctx.http()
    const res = await client.api.workspaces[":workspaceId"].tasks.search.$get({
      param: { workspaceId: id },
      query: { q: query.join(" ") },
    })
    return (await res.json()).tasks
  },
  human(ctx, tasks) {
    if (!ctx.mode.tty) return asTable(ctx.mode, tasks, "taskRef")
    if (tasks.length === 0) ctx.stderr("No tasks found.\n")
    const style = lineStyle(ctx)
    const found = tasks.map((t) => ({ ...t, status: statusText(t.status, style) }))
    return rows(ctx.mode, found, ["key", "status", "title"])
  },
})

async function taskLink(ctx: Ctx, ref: string) {
  const task = await resolver(ctx).task(ref)
  const { url } = await withUrl(ctx, task)
  return { id: task.id, key: task.key, url }
}

export const open = defineCommand({
  name: "open",
  summary: "Open a task in the browser",
  description:
    "Open a task in the web app. Without a terminal nothing is opened and the link is\n" +
    "printed on stderr instead; `task url` prints it on stdout.",
  args: [taskArg],
  context,
  output: "taskLink",
  examples: ["intesa task open WEB-12"],
  async run(ctx, { task: ref }) {
    const found = await taskLink(ctx, ref)
    openOrPrint(ctx, found.url)
    return found
  },
  human: () => "",
})

export const url = defineCommand({
  name: "url",
  summary: "Print a task's web link",
  description: 'Print the link to a task in the web app, like its "Copy link" menu item.',
  args: [taskArg],
  context,
  output: "taskLink",
  examples: ["intesa task url WEB-12", "intesa task url 12 -p WEB"],
  run: (ctx, { task: ref }) => taskLink(ctx, ref),
  human: (_ctx, found) => `${found.url}\n`,
})
