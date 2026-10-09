import { isRealDate } from "@intesa/api/schemas"
import {
  compileSearch,
  PRIORITY_RANK,
  parseTerms,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@intesa/task-query"
import { z } from "zod"
import { resolver } from "../../client/resolve"
import { usageError } from "../../output/errors"
import { defineCommand } from "../../registry/define"
import { linker, present, splitList, type TaskSummary } from "./shared"

const SORTS = ["board", "due", "priority", "status", "updated"] as const
const DUE_WORDS = ["overdue", "soon", "today", "none"]

const normalise = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "_")

function checked(flag: string, values: string[], allowed: readonly string[], extra = "") {
  for (const v of values) {
    if (!allowed.includes(normalise(v))) {
      throw usageError(`invalid value "${v}" for --${flag}: expected ${allowed.join("|")}${extra}`)
    }
  }
  return values.map(normalise)
}

// Quotes a value list that has spaces, so `Mei Member` stays one search term.
const term = (field: string, values: string[]) => {
  if (values.length === 0) return ""
  const joined = values.join(",")
  return `${field}:${/\s/.test(joined) ? `"${joined.replaceAll('"', "")}"` : joined}`
}

type Flags = {
  status?: string[]
  assignee?: string[]
  tag?: string[]
  priority?: string[]
  due?: string
  query?: string
  includeComplete: boolean
}

// The filter flags are sugar for the search syntax: they compile to the terms the web search
// box understands and are matched by the same code, together with -Q.
export function compileQuery(flags: Flags) {
  const due = flags.due === undefined ? [] : [flags.due.toLowerCase()]
  if (due[0] && !DUE_WORDS.includes(due[0]) && !isRealDate(due[0])) {
    throw usageError(
      `invalid value "${flags.due}" for --due: expected ${DUE_WORDS.join("|")} or YYYY-MM-DD`,
    )
  }
  let query = [
    term("status", checked("status", splitList(flags.status), TASK_STATUSES)),
    term(
      "assignee",
      splitList(flags.assignee).map((a) => (a === "@me" ? "me" : a)),
    ),
    term("tag", splitList(flags.tag)),
    term("priority", checked("priority", splitList(flags.priority), [...TASK_PRIORITIES, "none"])),
    term("due", due),
    flags.query ?? "",
  ]
    .filter(Boolean)
    .join(" ")
  // Like My tasks: completed work is hidden unless asked for, including by naming a status.
  const terms = parseTerms(query)
  const namesStatus = terms.some((t) => t.field === "status" && !t.negated && t.value !== "")
  if (!flags.includeComplete && !namesStatus) query = `${query} -status:complete`.trim()
  const wantsMe = terms.some((t) => t.field === "assignee" && t.value.split(",").includes("me"))
  return { query, wantsMe }
}

const statusIndex = (t: TaskSummary) => TASK_STATUSES.indexOf(t.status)
// Missing values sort last.
const nullsLast =
  <V extends string | number>(value: (t: TaskSummary) => V | null) =>
  (a: TaskSummary, b: TaskSummary) => {
    const x = value(a)
    const y = value(b)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return x < y ? -1 : 1
  }

const ORDER: Record<(typeof SORTS)[number], ((a: TaskSummary, b: TaskSummary) => number) | null> = {
  board: null,
  status: null,
  due: nullsLast((t) => t.dueAt),
  priority: nullsLast((t) => (t.priority ? PRIORITY_RANK[t.priority] : null)),
  updated: (a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0),
}

export const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List and filter tasks",
  description:
    "List a project's top-level tasks in board order: by column, then top to bottom.\n" +
    "--mine lists the tasks assigned to you in every project, subtasks included, and\n" +
    "--parent lists a task's subtasks.\n\n" +
    "Filtering uses the web search syntax: -Q takes a query as typed in the search box\n" +
    '(free text, "phrases", status:a,b, assignee:me, tag:x, priority:none, due:soon, has:due,\n' +
    "no:tag, -negation) and the filter flags add the same terms. Completed tasks are hidden\n" +
    "unless --include-complete is given or a status is named.",
  flags: z.object({
    mine: z
      .boolean()
      .default(false)
      .meta({ description: "Tasks assigned to you, across all projects" }),
    parent: z
      .string()
      .optional()
      .meta({ placeholder: "TASK", description: "Subtasks of this task" }),
    status: z
      .array(z.string())
      .optional()
      .meta({
        short: "s",
        placeholder: "status",
        description: `Only these statuses (${TASK_STATUSES.join(", ")})`,
      }),
    assignee: z.array(z.string()).optional().meta({
      short: "a",
      placeholder: "name",
      description: "Only tasks assigned to these people: me, unassigned or a name",
    }),
    tag: z
      .array(z.string())
      .optional()
      .meta({ short: "t", placeholder: "tag", description: "Only tasks with one of these tags" }),
    priority: z
      .array(z.string())
      .optional()
      .meta({
        placeholder: "priority",
        description: `Only these priorities (${TASK_PRIORITIES.join(", ")}, none)`,
      }),
    due: z.string().optional().meta({
      placeholder: "when",
      description: "overdue, soon, today, none or a date (YYYY-MM-DD)",
    }),
    includeComplete: z.boolean().default(false).meta({ description: "Include completed tasks" }),
    query: z
      .string()
      .optional()
      .meta({ short: "Q", placeholder: "query", description: "Filter with the search syntax" }),
    sort: z.enum(SORTS).default("board").meta({ placeholder: "order", description: "Sort order" }),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ short: "L", placeholder: "N", description: "Show at most N tasks" }),
  }),
  context: ["workspace", "project"],
  output: "task",
  examples: [
    "intesa task list -p WEB",
    "intesa task list --mine --sort due",
    "intesa task list -s todo,in_progress -a me",
    "intesa task list -Q 'assignee:me -tag:bug has:due' --json --fields key,title,status",
  ],
  async run(ctx, _args, flags) {
    if (flags.mine && flags.parent !== undefined) {
      throw usageError("--mine and --parent conflict: pass one")
    }
    if (flags.mine && ctx.globals.project) {
      throw usageError("--mine lists tasks across projects; leave out -p")
    }
    const { query, wantsMe } = compileQuery(flags)
    const r = resolver(ctx)
    const { client } = await ctx.http()

    let tasks: TaskSummary[]
    if (flags.parent !== undefined) {
      tasks = (await r.task(flags.parent)).subtasks
    } else if (flags.mine) {
      const { id } = await r.workspace()
      const res = await client.api.workspaces[":workspaceId"]["my-tasks"].$get({
        param: { workspaceId: id },
      })
      tasks = (await res.json()).tasks
    } else {
      const project = await r.project()
      const res = await client.api.projects[":projectId"].tasks.$get({
        param: { projectId: project.id },
      })
      tasks = (await res.json()).tasks
    }

    const match = compileSearch(query, { meId: wantsMe ? (await r.me()).id : undefined })
    const shown = (match ? tasks.filter(match) : tasks).sort(
      (a, b) => statusIndex(a) - statusIndex(b),
    )
    const order = ORDER[flags.sort]
    if (order) shown.sort(order)
    const withUrl = await linker(ctx)
    return present(ctx, shown.slice(0, flags.limit).map(withUrl))
  },
})
