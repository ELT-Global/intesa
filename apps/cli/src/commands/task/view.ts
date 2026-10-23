import { PRIORITY_LABELS, relativeTime, STATUS_LABELS } from "@intesa/task-query"
import { z } from "zod"
import { webLinks } from "../../client/links"
import { resolver } from "../../client/resolve"
import { openOrPrint } from "../../io/browser"
import { renderMarkdown } from "../../output/markdown"
import { rows, section } from "../../output/render"
import { dueText, formatTaskLines, priorityText, statusText } from "../../output/task-line"
import { type Ctx, defineCommand } from "../../registry/define"
import {
  type HistoryEntry,
  historyRows,
  lineStyle,
  relationRows,
  type TaskDetail,
  taskArg,
} from "./shared"

type Artifact = { id: string; name: string; mimeType: string; size: number }
type View = TaskDetail & { url: string; artifacts: Artifact[]; history?: HistoryEntry[] }

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`

// The name, "nobody" once answered that way, and a dash while nobody has answered.
const signoff = (who: { name: string } | null | undefined) =>
  who === undefined ? "—" : who === null ? "nobody" : who.name

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
async function format(ctx: Ctx, task: View, raw: boolean) {
  const { mode } = ctx
  const tty = mode.tty
  const style = lineStyle(ctx)
  const when = (iso: string) => (tty ? relativeTime(iso) : iso)
  const fields = await resolver(ctx).fields(task.projectId)

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
    ["Reviewed by", signoff(task.reviewedBy)],
    ["Tested by", signoff(task.testedBy)],
    ["Project", `${task.project.name} (${task.project.key})`],
    ["Parent", task.parent ? `${task.parent.key}  ${task.parent.title}` : ""],
    ["Created", when(task.createdAt)],
    ["Updated", when(task.updatedAt)],
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => ({ name, value }))

  const sections = [
    section(mode, `${task.key}  ${task.title}`, `${task.url}\n`),
    rows(mode, properties, ["name", "value"]),
  ]
  if (task.body?.trim()) {
    sections.push(tty && !raw ? renderMarkdown(task.body, mode) : `${task.body.trimEnd()}\n`)
  }
  if (task.subtasks.length > 0) {
    const done = `${task.subtaskDoneCount}/${task.subtaskCount} done`
    const subtasks = tty
      ? formatTaskLines(task.subtasks, style)
      : rows(
          mode,
          task.subtasks.map((s) => ({ ...s, status: STATUS_LABELS[s.status] })),
          ["key", "status", "title"],
        )
    sections.push(section(mode, `Subtasks (${done})`, subtasks))
  }
  const relations = relationRows(ctx, task)
  if (relations) sections.push(section(mode, "Relationships", relations))
  if (fields.length > 0) {
    const values = fields.map((f) => ({ name: f.name, value: fieldText(task.customFields[f.id]) }))
    sections.push(section(mode, "Custom fields", rows(mode, values, ["name", "value"])))
  }
  if (task.artifacts.length > 0) {
    const files = task.artifacts.map((a) => ({ ...a, size: size(a.size) }))
    sections.push(
      section(mode, `Artifacts (${files.length})`, rows(mode, files, ["name", "mimeType", "size"])),
    )
  }
  if (task.history) sections.push(section(mode, "History", historyRows(ctx, task.history)))
  return sections.join("\n")
}

export const view = defineCommand({
  name: "view",
  summary: "Show a task",
  description:
    "Show a task: its properties, description, subtasks, relationships, custom fields and\n" +
    "artifacts. On a terminal the description is rendered; --raw prints its markdown source.\n" +
    "--json prints the task as the API returns it, with its key, link and artifacts.\n" +
    "--web opens it in the browser when there is a terminal, and prints the link either way.",
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
  paged: true,
  examples: [
    "intesa task view WEB-12",
    "intesa task view 12 -p WEB --history",
    "intesa task view WEB-12 --json --fields key,status,subtasks",
  ],
  async run(ctx, { task: ref }, flags): Promise<View | undefined> {
    const task = await resolver(ctx).task(ref)
    // The task's own workspace, which a task id or link may name rather than the current one.
    const { url } = (await webLinks(ctx, task.project.workspaceId)).task(task)
    if (flags.web) {
      openOrPrint(ctx, url)
      return
    }
    const { client } = await ctx.http()
    const param = { param: { taskId: task.id } }
    const [artifacts, history] = await Promise.all([
      client.api.tasks[":taskId"].artifacts
        .$get(param)
        .then(async (res) => (await res.json()).artifacts),
      flags.history
        ? client.api.tasks[":taskId"].history
            .$get(param)
            .then(async (res) => (await res.json()).history)
        : undefined,
    ])
    return { ...task, url, artifacts, ...(history && { history }) }
  },
  human: (ctx, task, flags) => format(ctx, task, flags.raw),
})
