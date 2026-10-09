import { dayFromToday, formatDay, PRIORITY_LABELS, STATUS_LABELS } from "@intesa/task-query"
import { webLinks } from "../client/links"
import { resolver } from "../client/resolve"
import { rows, section } from "../output/render"
import { type Ctx, defineCommand } from "../registry/define"

type Task = {
  key: string
  title: string
  status: keyof typeof STATUS_LABELS
  priority: keyof typeof PRIORITY_LABELS | null
  dueAt: string | null
}
type Home = { projects: Record<string, unknown>[]; assigned: Task[]; dueSoon: Task[] }

// The web Home page's panels, as sections of aligned rows (TSV rows when piped).
function format(ctx: Ctx, home: Home) {
  const { mode } = ctx
  const tasks = (list: Task[]) =>
    rows(
      mode,
      list.map((t) => ({
        key: t.key,
        status: STATUS_LABELS[t.status],
        title: t.title,
        priority: t.priority ? PRIORITY_LABELS[t.priority] : "",
        due: t.dueAt ? (mode.tty ? `due ${formatDay(t.dueAt)}` : t.dueAt) : "",
      })),
      ["key", "status", "title", "priority", "due"],
    )
  const sections: [string, string, string][] = [
    [
      "Recent projects",
      "Nothing here yet. Create a project with `intesa project create NAME`.",
      rows(mode, home.projects, ["key", "name", "description"]),
    ],
    ["Assigned to you", "Nothing assigned to you right now.", tasks(home.assigned)],
    ["Due soon", "Nothing due in the next week.", tasks(home.dueSoon)],
  ]
  return sections
    .map(([title, empty, body]) => section(mode, title, body || `${empty}\n`))
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
    const [home, link] = await Promise.all([res.json(), webLinks(ctx, ws.id)])
    return {
      projects: home.projects.map(link.project),
      assigned: home.assigned.map(link.task),
      dueSoon: home.dueSoon.map(link.task),
    }
  },
  human: format,
})
