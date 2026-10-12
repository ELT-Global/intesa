import { parseWeek, weekBounds, weekLogMarkdown } from "@intesa/task-query"
import { z } from "zod"
import { webLinks } from "../client/links"
import { resolver } from "../client/resolve"
import { usageError } from "../output/errors"
import { renderMarkdown } from "../output/markdown"
import { type Arg, type Ctx, defineCommand } from "../registry/define"

type Log = Awaited<ReturnType<typeof loadWeek>>

// The week's tasks, each with its web link, for the person doing the reading.
async function loadWeek(ctx: Ctx, week: string) {
  const http = await ctx.http()
  const ws = await resolver(ctx).workspace()
  const { from, to } = weekBounds(week)
  const res = await http.client.api.workspaces[":workspaceId"].week.$get({
    param: { workspaceId: ws.id },
    query: { from, to },
  })
  const [log, link] = await Promise.all([res.json(), webLinks(ctx, ws.id)])
  return {
    week,
    from: log.from,
    to: log.to,
    people: log.people.map((person) => ({
      ...person,
      tasks: person.tasks.map((t) => ({
        ...t,
        url: link.task({ id: t.id, projectId: t.project.id }).url,
      })),
    })),
  }
}

// The web page's "Copy as Markdown" text: rendered on a terminal, its source when piped or --raw.
async function format(ctx: Ctx, log: Log, raw: boolean) {
  const r = resolver(ctx)
  const { id } = await r.workspace()
  const workspace = (await r.workspaces()).find((w) => w.id === id)?.name
  const markdown = weekLogMarkdown(log, { week: log.week, workspace, taskUrl: (t) => t.url })
  return ctx.mode.tty && !raw ? renderMarkdown(markdown, ctx.mode) : markdown
}

const weekArg = {
  name: "week",
  description: "this, last, next or a day (YYYY-MM-DD) in the week; this by default",
  complete: (_ctx: Ctx, { word }: { word: string }) =>
    ["this", "last", "next"].filter((c) => c.startsWith(word)),
} as const satisfies Arg

export default defineCommand({
  name: "week",
  summary: "Show what each person worked on in a week",
  description:
    "Show the workspace's weekly log: for each person the tasks assigned to them that week, which\n" +
    "were completed and which are still pending, when each was assigned and whether it was\n" +
    "carried over from an earlier week. Weeks run Monday to Sunday in local time. WEEK is `this`\n" +
    "(the default), `last`, `next` or any day as YYYY-MM-DD. The output is Markdown: rendered on\n" +
    "a terminal, its source when piped or with --raw. --json prints the people and their tasks.",
  context: ["workspace"],
  args: [weekArg],
  flags: z.object({
    raw: z
      .boolean()
      .default(false)
      .meta({ description: "Print the Markdown source, without rendering it" }),
  }),
  output: "week",
  paged: true,
  examples: [
    "intesa week",
    "intesa week last",
    "intesa week 2026-10-05 --raw | pbcopy",
    "intesa week --json",
  ],
  async run(ctx, { week: input = "this" }) {
    const week = parseWeek(input)
    if (!week) {
      throw usageError(
        `"${input}" is not a week`,
        "Use this, last, next or a day like 2026-10-05 (any day of the week).",
      )
    }
    return loadWeek(ctx, week)
  },
  human: (ctx, log, flags) => format(ctx, log, flags.raw),
})
