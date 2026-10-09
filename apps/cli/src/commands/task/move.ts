import { STATUSES, type Status } from "@intesa/api/schemas"
import { STATUS_LABELS } from "@intesa/task-query"
import { z } from "zod"
import { resolver } from "../../client/resolve"
import { confirmDestructive, isInteractive } from "../../output/ask"
import { usageError } from "../../output/errors"
import { type Ctx, defineCommand } from "../../registry/define"
import { linker, plural, present, splitList, type TaskSummary, taskArg, userIds } from "./shared"

const SUBTASK_MODES = ["keep", "match", "ask", ...STATUSES] as const
type SubtaskMode = (typeof SUBTASK_MODES)[number]

const moveFlags = z.object({
  before: z
    .string()
    .optional()
    .meta({ placeholder: "TASK", description: "Put it just above this task in the column" }),
  after: z
    .string()
    .optional()
    .meta({ placeholder: "TASK", description: "Put it just below this task in the column" }),
  top: z.boolean().default(false).meta({ description: "Put it at the top of the column" }),
  bottom: z.boolean().default(false).meta({ description: "Put it at the bottom of the column" }),
  subtasks: z.enum(SUBTASK_MODES).optional().meta({
    placeholder: "mode",
    description:
      "What happens to subtasks in another status (default: ask on a terminal, else keep)",
  }),
})
type MoveFlags = z.output<typeof moveFlags>

type OutOfSync = { key: string; status: Status }

// Picks which differing subtasks follow the parent. Cancelling leaves them as they are: the
// parent has moved already.
async function askSubtasks(differing: TaskSummary[], status: Status): Promise<string[]> {
  const { multiselect, isCancel } = await import("@clack/prompts")
  const picked = await multiselect({
    message: `Move these subtasks to ${STATUS_LABELS[status]} too?`,
    options: differing.map((s) => ({
      value: s.id,
      label: `${s.key}  ${s.title}`,
      hint: STATUS_LABELS[s.status],
    })),
    initialValues: differing.map((s) => s.id),
    required: false,
    output: process.stderr,
  })
  return isCancel(picked) ? [] : picked
}

// Like the web's "Update subtasks?" dialog, with one PATCH per subtask. Asking only happens
// when the parent changed column (not for a reorder); match and a status apply regardless.
// Returns the subtasks left in another status than the parent.
async function syncSubtasks(
  ctx: Ctx,
  subtasks: TaskSummary[],
  status: Status,
  opts: { mode: SubtaskMode | undefined; changed: boolean },
): Promise<OutOfSync[]> {
  const current = subtasks.map((s) => ({ ...s }))
  const differing = current.filter((s) => s.status !== status)
  const { mode } = opts
  const chosen =
    mode === "ask" || mode === undefined
      ? isInteractive(ctx) && opts.changed
        ? "ask"
        : "keep"
      : mode
  let updates: { task: TaskSummary; to: Status }[] = []
  if (chosen === "match") updates = differing.map((task) => ({ task, to: status }))
  else if (chosen === "ask" && differing.length > 0) {
    const ids = new Set(await askSubtasks(differing, status))
    updates = differing.filter((s) => ids.has(s.id)).map((task) => ({ task, to: status }))
  } else if (chosen !== "keep" && chosen !== "ask") {
    updates = current.filter((s) => s.status !== chosen).map((task) => ({ task, to: chosen }))
  }
  const { client } = await ctx.http()
  for (const { task, to } of updates) {
    await client.api.tasks[":taskId"].$patch({ param: { taskId: task.id }, json: { status: to } })
    task.status = to
  }
  return current.filter((s) => s.status !== status).map((s) => ({ key: s.key, status: s.status }))
}

async function moveTask(ctx: Ctx, ref: string, status: Status, flags: MoveFlags) {
  const placements = [flags.before, flags.after].filter((v) => v !== undefined).length
  if (placements + Number(flags.top) + Number(flags.bottom) > 1) {
    throw usageError("--before, --after, --top and --bottom conflict: pass one")
  }
  const r = resolver(ctx)
  const task = await r.task(ref)
  const anchor = async (other: string) => (await r.task(other)).id
  const placement =
    flags.before !== undefined
      ? { before: await anchor(flags.before) }
      : flags.after !== undefined
        ? { after: await anchor(flags.after) }
        : flags.top
          ? ("first" as const)
          : flags.bottom
            ? ("last" as const)
            : undefined

  const { client } = await ctx.http()
  const res = await client.api.tasks[":taskId"].$patch({
    param: { taskId: task.id },
    json: { status, ...(placement && { placement }) },
  })
  const moved = (await res.json()).task
  const subtasksOutOfSync = await syncSubtasks(ctx, task.subtasks, status, {
    mode: flags.subtasks,
    changed: task.status !== status,
  })
  const note = task.status !== status && !ctx.globals.json && !ctx.globals.quiet
  if (note && subtasksOutOfSync.length > 0) {
    const list = subtasksOutOfSync.map((s) => `${s.key} (${STATUS_LABELS[s.status]})`).join(", ")
    ctx.stderr(
      `${plural(subtasksOutOfSync.length, "subtask")} not ${STATUS_LABELS[status]}: ${list}\n` +
        "Pass --subtasks match to move them too.\n",
    )
  }
  return present(ctx, { ...(await linker(ctx))(moved), subtasksOutOfSync })
}

export const move = defineCommand({
  name: "move",
  aliases: ["mv"],
  summary: "Move a task to a status, optionally placing it in the column",
  description:
    "Move a task to another column, or within one with --before, --after, --top or --bottom.\n" +
    "A task changing column goes to the top unless a placement is given.\n\n" +
    "When the task has subtasks in another status, --subtasks says what happens to them:\n" +
    "keep leaves them (the JSON output lists them as subtasksOutOfSync), match moves them\n" +
    "to the new status, a status moves all of them there, and ask lets you pick on a\n" +
    "terminal. One request is sent per subtask.",
  args: [
    taskArg,
    { name: "status", required: true, enum: STATUSES, description: "The status to move it to" },
  ],
  flags: moveFlags,
  context: ["workspace", "project"],
  output: "taskMove",
  examples: [
    "intesa task move WEB-12 review",
    "intesa task move WEB-12 todo --top",
    "intesa task move WEB-12 in_progress --after WEB-9",
    "intesa task move WEB-12 complete --subtasks match --json",
  ],
  run: (ctx, { task, status }, flags) => moveTask(ctx, task, status as Status, flags),
})

const shorthand = (name: string, status: Status) =>
  defineCommand({
    name,
    summary: `Move a task to ${STATUS_LABELS[status]}`,
    description: `Same as \`intesa task move TASK ${status}\`, with the same flags.`,
    args: [taskArg],
    flags: moveFlags,
    context: ["workspace", "project"],
    output: "taskMove",
    examples: [`intesa task ${name} WEB-12`],
    run: (ctx, { task }, flags) => moveTask(ctx, task, status, flags),
  })

export const start = shorthand("start", "in_progress")
export const review = shorthand("review", "review")
export const done = shorthand("done", "complete")

const peopleArg = {
  name: "people",
  variadic: true,
  description: "Emails, names or @me (default: @me)",
} as const

async function changeAssignees(ctx: Ctx, ref: string, people: string[], add: boolean) {
  const task = await resolver(ctx).task(ref)
  const refs = splitList(people)
  const ids = await userIds(ctx, refs.length > 0 ? refs : ["@me"])
  const current = task.assignees.map((a) => a.id)
  const assigneeIds = add
    ? [...new Set([...current, ...ids])]
    : current.filter((id) => !ids.includes(id))
  const { client } = await ctx.http()
  const res = await client.api.tasks[":taskId"].$patch({
    param: { taskId: task.id },
    json: { assigneeIds },
  })
  return present(ctx, (await linker(ctx))((await res.json()).task))
}

export const assign = defineCommand({
  name: "assign",
  summary: "Assign people to a task",
  description: "Add people to a task's assignees; the ones already assigned stay.",
  args: [taskArg, peopleArg],
  context: ["workspace", "project"],
  output: "task",
  examples: ["intesa task assign WEB-12", 'intesa task assign WEB-12 @me "Mei Chen"'],
  run: (ctx, { task, people }) => changeAssignees(ctx, task, people, true),
})

export const unassign = defineCommand({
  name: "unassign",
  summary: "Remove people from a task",
  description: "Remove people from a task's assignees; the others stay.",
  args: [taskArg, peopleArg],
  context: ["workspace", "project"],
  output: "task",
  examples: ["intesa task unassign WEB-12", "intesa task unassign WEB-12 mei@example.com"],
  run: (ctx, { task, people }) => changeAssignees(ctx, task, people, false),
})

export const remove = defineCommand({
  name: "delete",
  aliases: ["rm"],
  summary: "Delete a task and its subtasks",
  description:
    "Delete a task together with its subtasks and artifacts. Asks first on a terminal;\n" +
    "otherwise --yes is required.",
  args: [taskArg],
  context: ["workspace", "project"],
  examples: ["intesa task delete WEB-12", "intesa task delete WEB-12 --yes"],
  async run(ctx, { task: ref }) {
    const task = await resolver(ctx).task(ref)
    if (task.subtaskCount > 0) {
      ctx.stderr(
        `${task.key} has ${plural(task.subtaskCount, "subtask")}, which will be deleted with it.\n`,
      )
    }
    await confirmDestructive(ctx, `Delete ${task.key} (${task.title})?`)
    const { client } = await ctx.http()
    await client.api.tasks[":taskId"].$delete({ param: { taskId: task.id } })
    if (ctx.globals.json) return { id: task.id, key: task.key, deleted: true }
    if (!ctx.globals.quiet) ctx.stderr(`✓ Deleted ${task.key}\n`)
  },
})
