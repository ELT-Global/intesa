import { styleText } from "node:util"
import { PRIORITY_LABELS, relativeTime, STATUS_LABELS } from "@intesa/task-query"
import { z } from "zod"
import { resolver } from "../../client/resolve"
import { openBrowser } from "../../io/browser"
import { renderMarkdown } from "../../output/markdown"
import { formatTable } from "../../output/table"
import { dueText, formatTaskLines, glyphs, priorityText, statusText } from "../../output/task-line"
import { type Ctx, defineCommand } from "../../registry/define"
import { lineStyle, linker, type TaskDetail, taskArg } from "./shared"

type Artifact = { id: string; name: string; mimeType: string; size: number }
type History = {
  fromStatus: TaskDetail["status"] | null
  toStatus: TaskDetail["status"]
  updatedAt: string
  updatedBy: { name: string }
}
type Field = { id: string; name: string; type: string }
type View = TaskDetail & { url: string; artifacts: Artifact[]; history?: History[] }

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`

const fieldText = (value: unknown) =>
  value === undefined || value === null
    ? ""
    : typeof value === "boolean"
      ? value
        ? "yes"
        : "no"
      : String(value)

// The detail panel as text. On a terminal: glyphs, colors, relative dates and rendered
// markdown; piped: plain rows, ISO dates and the markdown source, so it reads the same anywhere.
function format(ctx: Ctx, task: View, fields: Field[], raw: boolean) {
  const tty = ctx.mode.tty
  const style = lineStyle(ctx)
  const table = { tty, width: ctx.mode.width, header: false }
  const heading = (text: string) => (ctx.mode.color ? styleText("bold", text) : text)
  const when = (iso: string) => (tty ? relativeTime(iso) : iso)

  const properties = [
    ["Status", tty ? statusText(task.status, style) : STATUS_LABELS[task.status]],
    [
      "Priority",
      task.priority
        ? tty
          ? priorityText(task.priority, style)
          : PRIORITY_LABELS[task.priority]
        : "",
    ],
    ["Due", task.dueAt ? (tty ? dueText(task.dueAt, task.status, style) : task.dueAt) : ""],
    ["Assignees", task.assignees.map((a) => a.name).join(", ")],
    ["Tags", task.tags.map((g) => g.name).join(", ")],
    ["Project", `${task.project.name} (${task.project.key})`],
    ["Parent", task.parent ? `${task.parent.key}  ${task.parent.title}` : ""],
    ["Created", when(task.createdAt)],
    ["Updated", when(task.updatedAt)],
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => ({ name, value }))

  const sections = [
    `${heading(`${task.key}  ${task.title}`)}\n${task.url}\n`,
    formatTable(properties, ["name", "value"], table),
  ]
  if (task.body?.trim()) {
    sections.push(tty && !raw ? renderMarkdown(task.body, ctx.mode) : `${task.body.trimEnd()}\n`)
  }
  if (task.subtasks.length > 0) {
    const done = `${task.subtaskDoneCount}/${task.subtaskCount} done`
    sections.push(
      `${heading(`Subtasks (${done})`)}\n${
        tty
          ? formatTaskLines(task.subtasks, style)
          : formatTable(
              task.subtasks.map((s) => ({ ...s, status: STATUS_LABELS[s.status] })),
              ["key", "status", "title"],
              table,
            )
      }`,
    )
  }
  const relations = (
    [
      ["Blocks", task.blocks],
      ["Blocked by", task.blockedBy],
      ["Related", task.related],
    ] as const
  ).flatMap(([kind, refs]) =>
    refs.map((t) => ({ kind, key: t.key, title: t.title, status: STATUS_LABELS[t.status] })),
  )
  if (relations.length > 0) {
    sections.push(
      `${heading("Relationships")}\n${formatTable(relations, ["kind", "key", "title", "status"], table)}`,
    )
  }
  if (fields.length > 0) {
    const rows = fields.map((f) => ({ name: f.name, value: fieldText(task.customFields[f.id]) }))
    sections.push(`${heading("Custom fields")}\n${formatTable(rows, ["name", "value"], table)}`)
  }
  if (task.artifacts.length > 0) {
    const rows = task.artifacts.map((a) => ({ ...a, size: size(a.size) }))
    sections.push(
      `${heading(`Artifacts (${rows.length})`)}\n${formatTable(rows, ["name", "mimeType", "size"], table)}`,
    )
  }
  if (task.history) {
    const arrow = tty ? glyphs(style).arrow : "->"
    const rows = task.history.map((h) => ({
      at: when(h.updatedAt),
      by: h.updatedBy.name,
      change: `${h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} ${arrow} ` : ""}${STATUS_LABELS[h.toStatus]}`,
    }))
    sections.push(`${heading("History")}\n${formatTable(rows, ["at", "by", "change"], table)}`)
  }
  return sections.join("\n")
}

export const view = defineCommand({
  name: "view",
  summary: "Show a task",
  description:
    "Show a task: its properties, description, subtasks, relationships, custom fields and\n" +
    "artifacts. On a terminal the description is rendered; --raw prints its markdown source.\n" +
    "--json prints the task as the API returns it, with its key, link and artifacts.",
  args: [taskArg],
  flags: z.object({
    web: z.boolean().default(false).meta({ description: "Open the task in the browser" }),
    history: z.boolean().default(false).meta({ description: "Include the status history" }),
    raw: z
      .boolean()
      .default(false)
      .meta({ description: "Print the description as markdown, without rendering it" }),
  }),
  context: ["workspace", "project"],
  output: "taskDetail",
  examples: [
    "intesa task view WEB-12",
    "intesa task view 12 -p WEB --history",
    "intesa task view WEB-12 --json --fields key,status,subtasks",
  ],
  async run(ctx, { task: ref }, flags) {
    const r = resolver(ctx)
    const task = await r.task(ref)
    const withUrl = await linker(ctx)
    const { url } = withUrl(task)
    if (flags.web) {
      const opened = openBrowser(url, { env: ctx.env, configBrowser: ctx.config.browser })
      ctx.stderr(opened ? `Opening ${url} in your browser.\n` : `Open ${url} in your browser.\n`)
      return
    }
    const { client } = await ctx.http()
    const param = { param: { taskId: task.id } }
    const [artifacts, history, fields] = await Promise.all([
      client.api.tasks[":taskId"].artifacts
        .$get(param)
        .then(async (res) => (await res.json()).artifacts),
      flags.history
        ? client.api.tasks[":taskId"].history
            .$get(param)
            .then(async (res) => (await res.json()).history)
        : undefined,
      ctx.globals.json ? [] : r.fields(task.projectId),
    ])
    const result: View = { ...task, url, artifacts, ...(history && { history }) }
    const { json, quiet, fields: only } = ctx.globals
    if (json || quiet || only) return result
    ctx.stdout(format(ctx, result, fields, flags.raw))
  },
})
