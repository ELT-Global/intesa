import { styleText } from "node:util"
import { dayFromToday, formatDay, PRIORITY_LABELS, STATUS_LABELS } from "@intesa/task-query"
import { links, resolver } from "../client/resolve"
import { formatTable } from "../output/table"
import { type Ctx, defineCommand } from "../registry/define"

type Row = Record<string, unknown>
type Task = {
  key: string
  title: string
  status: keyof typeof STATUS_LABELS
  priority: keyof typeof PRIORITY_LABELS | null
  dueAt: string | null
}
type Home = { projects: Row[]; assigned: Task[]; dueSoon: Task[] }

// The web Home page's panels, as sections of aligned rows (TSV rows when piped).
function format(ctx: Ctx, home: Home, only: string[] | undefined) {
  const table = { tty: ctx.mode.tty, width: ctx.mode.width, header: false }
  const heading = (text: string) => (ctx.mode.color ? styleText("bold", text) : text)
  const tasks = (list: Task[]) =>
    formatTable(
      list.map((t) => ({
        key: t.key,
        status: STATUS_LABELS[t.status],
        title: t.title,
        priority: t.priority ? PRIORITY_LABELS[t.priority] : "",
        due: t.dueAt ? (ctx.mode.tty ? `due ${formatDay(t.dueAt)}` : t.dueAt) : "",
      })),
      ["key", "status", "title", "priority", "due"],
      table,
    )
  const sections: [keyof Home, string, string, string][] = [
    [
      "projects",
      "Recent projects",
      "Nothing here yet. Create a project with `intesa project create NAME`.",
      formatTable(home.projects, ["key", "name", "description"], table),
    ],
    ["assigned", "Assigned to you", "Nothing assigned to you right now.", tasks(home.assigned)],
    ["dueSoon", "Due soon", "Nothing due in the next week.", tasks(home.dueSoon)],
  ]
  return sections
    .filter(([name]) => !only || only.includes(name))
    .map(([, title, empty, body]) => `${heading(title)}\n${body || `${empty}\n`}`)
    .join("\n")
}

export default defineCommand({
  name: "status",
  summary: "Show your recent projects, your tasks and what is due soon",
  description:
    "Show the workspace's Home page: recently updated projects, open tasks assigned to you and\n" +
    "tasks due within a week (or overdue).",
  context: ["workspace"],
  output: "status",
  examples: ["intesa status", "intesa status -w acme --json --fields assigned"],
  async run(ctx) {
    const http = await ctx.http()
    const ws = await resolver(ctx).workspace()
    const res = await http.client.api.workspaces[":workspaceId"].home.$get({
      param: { workspaceId: ws.id },
      // The local date, so "due soon" means the day the person is looking at.
      query: { today: dayFromToday(0) },
    })
    const home = await res.json()
    const withUrl = <T extends { id: string; projectId: string }>(t: T) => ({
      ...t,
      url: links.task(http.host, ws.slug, t),
    })
    const data = {
      projects: home.projects.map((p) => ({ ...p, url: links.project(http.host, ws.slug, p.id) })),
      assigned: home.assigned.map(withUrl),
      dueSoon: home.dueSoon.map(withUrl),
    }
    if (ctx.globals.json) return data
    ctx.stdout(
      format(
        ctx,
        data,
        ctx.globals.fields?.split(",").map((f) => f.trim()),
      ),
    )
  },
})
