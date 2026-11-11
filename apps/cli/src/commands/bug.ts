import { BUG_STATUSES, PRIORITIES } from "@intesa/api/schemas"
import { relativeTime, STATUS_LABELS } from "@intesa/task-query"
import { z } from "zod"
import { people, tagNames } from "../client/candidates"
import { webLinks } from "../client/links"
import { resolver } from "../client/resolve"
import { CliError, usageError } from "../output/errors"
import { renderMarkdown } from "../output/markdown"
import { asTable, rows, section } from "../output/render"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"
import { dueDate, readBody, showTasks, splitList, tagIds, userIds } from "./task/shared"

const bugArg = {
  name: "bug",
  required: true,
  description: "Bug key like WEB-B3, B3 with -p, or a bug id",
} as const

type BugDetail = Awaited<ReturnType<ReturnType<typeof resolver>["bug"]>>
type BugView = BugDetail & { url: string }

// The bug with its web link, in the bug's own workspace.
const withUrl = async <B extends { id: string; projectId: string }>(ctx: Ctx, bug: B) => {
  const { workspaceId } = await resolver(ctx).project(bug.projectId)
  return (await webLinks(ctx, workspaceId)).bug(bug)
}

// A pending bug whose earlier tasks were completed has come back: "regressed (1)".
const statusText = (bug: { status: string; regressions: number }) =>
  bug.status === "pending" && bug.regressions > 0 ? `regressed (${bug.regressions})` : bug.status

const textFlags = {
  title: z.string().optional().meta({ short: "T", placeholder: "title", description: "Title" }),
  body: z
    .string()
    .optional()
    .meta({ short: "b", placeholder: "text", description: "Description (markdown)" }),
  bodyFile: z.string().optional().meta({
    short: "F",
    placeholder: "file",
    description: "Read the description from a file (- for stdin)",
  }),
}

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List a project's bugs",
  description:
    "List the current project's bugs, pending ones first, then the newest. A bug is pending\n" +
    "while any of its tasks is not complete, and resolved when all are.",
  flags: z.object({
    status: z
      .enum(BUG_STATUSES)
      .optional()
      .meta({ placeholder: "status", description: "Only pending or resolved bugs" }),
  }),
  context: ["workspace", "project"],
  output: "bug",
  examples: ["intesa bug list -p WEB", "intesa b list --status pending --json --fields key,title"],
  async run(ctx, _args, flags) {
    const { id: projectId, workspaceId } = await resolver(ctx).project()
    const { client } = await ctx.http()
    const res = await client.api.projects[":projectId"].bugs.$get({
      param: { projectId },
      query: flags.status ? { status: flags.status } : {},
    })
    const links = await webLinks(ctx, workspaceId)
    return (await res.json()).bugs.map(links.bug)
  },
  human: (ctx, bugs) =>
    asTable(
      ctx.mode,
      bugs.map((b) => ({ ...b, status: statusText(b) })),
      "bug",
    ),
})

function format(ctx: Ctx, bug: BugView, raw: boolean) {
  const { mode } = ctx
  const when = (iso: string) => (mode.tty ? relativeTime(iso) : iso)
  const properties = [
    { name: "Status", value: statusText(bug) },
    { name: "Raised", value: when(bug.createdAt) },
    { name: "Fixed", value: bug.fixedAt ? when(bug.fixedAt) : "—" },
    { name: "Regressions", value: String(bug.regressions) },
    { name: "Updated", value: when(bug.updatedAt) },
  ]
  const tasks = rows(
    mode,
    bug.tasks.map((t) => ({ ...t, status: STATUS_LABELS[t.status] })),
    ["key", "status", "title"],
  )
  const sections = [
    section(mode, `${bug.key}  ${bug.title}`, `${bug.url}\n`),
    rows(mode, properties, ["name", "value"]),
  ]
  if (bug.body?.trim()) {
    sections.push(mode.tty && !raw ? renderMarkdown(bug.body, mode) : `${bug.body.trimEnd()}\n`)
  }
  sections.push(section(mode, `Tasks (${bug.tasks.length})`, tasks))
  return sections.join("\n")
}

const view = defineCommand({
  name: "view",
  summary: "Show a bug",
  description:
    "Show a bug: its status, description and the tasks that worked on it, oldest first.\n" +
    "On a terminal the description is rendered; --raw prints its markdown source.",
  args: [bugArg],
  flags: z.object({
    raw: z
      .boolean()
      .default(false)
      .meta({ description: "Print the description as markdown, without rendering it" }),
  }),
  context: ["workspace", "project"],
  output: "bugDetail",
  paged: true,
  examples: ["intesa bug view WEB-B3", "intesa b view web-b3 --json --fields key,status,tasks"],
  run: async (ctx, { bug }) => withUrl(ctx, await resolver(ctx).bug(bug)),
  human: (ctx, bug, flags) => format(ctx, bug, flags.raw),
})

const edit = defineCommand({
  name: "edit",
  summary: "Change a bug's title or description",
  description: "Change a bug's own title or description. Editing a bug never changes its tasks.",
  args: [bugArg],
  flags: z.object(textFlags),
  context: ["workspace", "project"],
  output: "bugDetail",
  examples: [
    'intesa bug edit WEB-B3 -T "Login fails with SSO"',
    "intesa bug edit WEB-B3 -F steps.md",
  ],
  async run(ctx, { bug: ref }, flags) {
    if (flags.title === undefined && flags.body === undefined && flags.bodyFile === undefined) {
      throw usageError("nothing to change: pass --title, --body or --body-file")
    }
    const body = await readBody(ctx, flags)
    const bug = await resolver(ctx).bug(ref)
    const { client } = await ctx.http()
    const res = await client.api.bugs[":bugId"].$patch({
      param: { bugId: bug.id },
      json: { title: flags.title, body },
    })
    return withUrl(ctx, (await res.json()).bug)
  },
  human: (ctx, bug) => format(ctx, bug, false),
})

// The 409 the server sends names no task; the CLI does.
function stillPending(bug: BugDetail, cause?: CliError) {
  const open = bug.tasks.filter((t) => t.status !== "complete")
  const names = open.map((t) => `${t.key} (${STATUS_LABELS[t.status]})`).join(", ")
  return new CliError(
    open.length > 0
      ? `${bug.key} is still pending: complete ${names} before opening another task`
      : (cause?.message ?? `${bug.key} is still pending`),
    {
      code: "CONFLICT",
      exitCode: 6,
      hint: open[0] ? `Run \`intesa task done ${open[0].key}\` once it is fixed.` : undefined,
    },
  )
}

const reopen = defineCommand({
  name: "reopen",
  summary: "Open a regression task for a resolved bug",
  description:
    "Open a new task for a resolved bug, which makes the bug pending again. The task is\n" +
    "created in the bug's project, tagged bug and linked to the bug. Its title defaults to the\n" +
    "bug's. A bug that is still pending has an open task already: this exits 6 and names it.",
  args: [bugArg],
  flags: z.object({
    ...textFlags,
    priority: z
      .enum(PRIORITIES)
      .optional()
      .meta({ placeholder: "priority", description: "Priority" }),
    due: z.string().optional().meta({ placeholder: "YYYY-MM-DD", description: "Due date" }),
    assignee: z.array(z.string()).default([]).meta({
      short: "a",
      placeholder: "person",
      description: "Assign people: @me, an email or a name",
      complete: people,
    }),
    tag: z.array(z.string()).default([]).meta({
      short: "t",
      placeholder: "tag",
      description: "Add tags besides bug",
      complete: tagNames,
    }),
    createTags: z
      .boolean()
      .default(false)
      .meta({ description: "Create tags that do not exist yet" }),
  }),
  context: ["workspace", "project"],
  output: "bugReopened",
  examples: [
    "intesa bug reopen WEB-B3",
    'intesa bug reopen WEB-B3 -T "Login fails again" -a @me --priority high',
  ],
  async run(ctx, { bug: ref }, flags) {
    const dueAt = dueDate(flags.due)
    const body = await readBody(ctx, flags)
    const r = resolver(ctx)
    const bug = await r.bug(ref)
    if (bug.status === "pending") throw stillPending(bug)
    const assigneeIds = await userIds(ctx, splitList(flags.assignee))
    const tags = await tagIds(ctx, splitList(flags.tag), flags.createTags)
    // Resolved before the POST: a failure after it would leave the task created.
    const { workspaceId } = await r.project(bug.projectId)

    const { client } = await ctx.http()
    const post = async () =>
      (
        await client.api.bugs[":bugId"].tasks.$post({
          param: { bugId: bug.id },
          json: {
            title: flags.title,
            body,
            priority: flags.priority,
            dueAt,
            ...(assigneeIds.length > 0 && { assigneeIds }),
            ...(tags.length > 0 && { tagIds: tags }),
          },
        })
      ).json()
    let created: Awaited<ReturnType<typeof post>>
    try {
      created = await post()
    } catch (err) {
      // Someone opened a task between the lookup and the request.
      if (err instanceof CliError && err.exitCode === 6)
        throw stillPending(await r.bug(bug.id), err)
      throw err
    }
    const links = await webLinks(ctx, workspaceId)
    const task = links.task(created.task)
    ctx.done(`Opened ${task.key} for ${created.bug.key}`)
    return { ...task, bug: links.bug(created.bug) }
  },
  human: (ctx, task) => showTasks(ctx, task),
})

export default defineGroup({
  name: "bug",
  aliases: ["b"],
  summary: "List, view and edit a project's bugs, and reopen resolved ones",
  description:
    "A bug groups the tasks tagged bug that worked on one problem. It is created when a task\n" +
    "gets the bug tag, and is pending while any of its tasks is not complete, resolved when\n" +
    "all are. Its key is the project key, B and a number: WEB-B3. `bug reopen` opens a\n" +
    "regression task for a resolved bug.",
  commands: [list, view, edit, reopen],
  examples: ["intesa bug list --status pending", "intesa b view WEB-B3", "intesa b reopen WEB-B3"],
})
