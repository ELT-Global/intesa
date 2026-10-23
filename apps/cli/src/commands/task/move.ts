import { STATUSES, type Status } from "@intesa/api/schemas"
import { STATUS_LABELS } from "@intesa/task-query"
import { z } from "zod"
import { taskKeys } from "../../client/candidates"
import { webLinks } from "../../client/links"
import { resolver } from "../../client/resolve"
import { choose, confirmDestructive, isInteractive } from "../../io/prompt"
import { CliError, formatError, prefixed, usageError } from "../../output/errors"
import { type Ctx, defineCommand } from "../../registry/define"
import {
  plural,
  showTasks,
  signoffFlags,
  signoffId,
  splitList,
  type TaskDetail,
  type TaskSummary,
  taskArg,
  userIds,
} from "./shared"

const SUBTASK_MODES = ["keep", "match", "ask", ...STATUSES] as const
export type SubtaskMode = (typeof SUBTASK_MODES)[number]

const moveFlags = z.object({
  before: z.string().optional().meta({
    placeholder: "TASK",
    description: "Put it just above this task in the column",
    complete: taskKeys,
  }),
  after: z.string().optional().meta({
    placeholder: "TASK",
    description: "Put it just below this task in the column",
    complete: taskKeys,
  }),
  top: z.boolean().default(false).meta({ description: "Put it at the top of the column" }),
  bottom: z.boolean().default(false).meta({ description: "Put it at the bottom of the column" }),
  subtasks: z.enum(SUBTASK_MODES).optional().meta({
    placeholder: "mode",
    description:
      "What happens to subtasks in another status (default: ask on a terminal, else keep)",
  }),
  ...signoffFlags,
})
type MoveFlags = z.output<typeof moveFlags>

// The web's "Update subtasks?" dialog as prompts: all at once, one by one, or none.
// Cancelling leaves them as they are: the parent has moved already.
async function askSubtasks(differing: TaskSummary[], status: Status) {
  const label = STATUS_LABELS[status]
  const all = differing.map((task) => ({ task, to: status }))
  const how = await choose(
    `${plural(differing.length, "subtask")} not ${label}. Update them?`,
    [
      { value: "all", label: `Set all to ${label}` },
      { value: "each", label: "Choose for each subtask" },
      { value: "none", label: "Leave as is" },
    ],
    "all",
  )
  if (how === "all") return all
  if (how !== "each") return []
  const picked: typeof all = []
  for (const sub of differing) {
    const choice = await choose(`${sub.key}  ${sub.title}`, [
      { value: "keep", label: `Keep ${STATUS_LABELS[sub.status]}` },
      { value: "set", label: `Set to ${label}` },
    ])
    if (choice === undefined) return []
    if (choice === "set") picked.push({ task: sub, to: status })
  }
  return picked
}

// Which subtasks to move where, like the web's "Update subtasks?" dialog. Asking only happens
// when the parent changed column (not for a reorder); match and a status apply regardless.
async function subtaskUpdates(
  ctx: Ctx,
  subtasks: TaskSummary[],
  status: Status,
  opts: { mode: SubtaskMode | undefined; changed: boolean },
): Promise<{ task: TaskSummary; to: Status }[]> {
  const differing = subtasks.filter((s) => s.status !== status)
  const mode = opts.mode ?? (isInteractive(ctx) ? "ask" : "keep")
  if (mode === "keep" || differing.length === 0) return []
  if (mode === "match") return differing.map((task) => ({ task, to: status }))
  if (mode === "ask") return opts.changed ? askSubtasks(differing, status) : []
  return subtasks.filter((s) => s.status !== mode).map((task) => ({ task, to: mode }))
}

async function moveTask(ctx: Ctx, ref: string, status: Status, flags: MoveFlags) {
  const placements = [flags.before, flags.after].filter((v) => v !== undefined).length
  if (placements + Number(flags.top) + Number(flags.bottom) > 1) {
    throw usageError("--before, --after, --top and --bottom conflict: pass one")
  }
  if (flags.subtasks === "ask" && !isInteractive(ctx)) {
    throw usageError("--subtasks ask needs a terminal: pass keep, match or a status")
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

  const reviewedById = await signoffId(ctx, flags.reviewedBy)
  const testedById = await signoffId(ctx, flags.testedBy)

  const { client } = await ctx.http()
  const res = await client.api.tasks[":taskId"].$patch({
    param: { taskId: task.id },
    json: { status, reviewedById, testedById, ...(placement && { placement }) },
  })
  const moved = (await webLinks(ctx, task.project.workspaceId)).task((await res.json()).task)
  return withSubtaskSync(ctx, task, status, moved, flags.subtasks)
}

// After `task` (as it was) was set to `status`, with `moved` as the result: brings its
// subtasks along as `mode` says and adds subtasksOutOfSync, what still differs. When some
// subtask updates fail, the others still happen and the error carries the result.
export async function withSubtaskSync<T extends object>(
  ctx: Ctx,
  task: TaskDetail,
  status: Status,
  moved: T,
  mode: SubtaskMode | undefined,
) {
  const { client } = await ctx.http()
  // One PATCH per subtask; a failure does not stop the others.
  const updates = await subtaskUpdates(ctx, task.subtasks, status, {
    mode,
    changed: task.status !== status,
  })
  const failures: CliError[] = []
  for (const { task: sub, to } of updates) {
    try {
      await client.api.tasks[":taskId"].$patch({ param: { taskId: sub.id }, json: { status: to } })
    } catch (err) {
      if (!(err instanceof CliError)) throw err
      failures.push(prefixed(sub.key, err))
    }
  }
  // Read back rather than assumed: a subtask may also have moved elsewhere meanwhile.
  let subtasks: TaskDetail["subtasks"] = task.subtasks
  if (updates.length > 0) {
    const fresh = await client.api.tasks[":taskId"].$get({ param: { taskId: task.id } })
    subtasks = (await fresh.json()).task.subtasks
  }
  const subtasksOutOfSync = subtasks
    .filter((s) => s.status !== status)
    .map((s) => ({ key: s.key, status: s.status }))
  const result = { ...moved, subtasksOutOfSync }

  const [first] = failures
  if (first) {
    for (const failure of failures) ctx.stderr(formatError(failure, ctx.globals.json))
    throw new CliError(`${plural(failures.length, "subtask")} of ${updates.length} not moved`, {
      code: first.code,
      exitCode: first.exitCode,
      result,
    })
  }
  const note = task.status !== status && !ctx.globals.json && !ctx.globals.quiet
  if (note && subtasksOutOfSync.length > 0) {
    const list = subtasksOutOfSync.map((s) => `${s.key} (${STATUS_LABELS[s.status]})`).join(", ")
    ctx.stderr(
      `${plural(subtasksOutOfSync.length, "subtask")} not ${STATUS_LABELS[status]}: ${list}\n` +
        `Run \`intesa task move ${task.key} ${status} --subtasks match\` to move them too.\n`,
    )
  }
  return result
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
    "to the new status, a status moves all of them there, and ask lets you pick; ask needs\n" +
    "a terminal, and without one the default is keep. One request is sent per subtask; when\n" +
    "some fail, the others still move, the result is printed and the exit code is the first\n" +
    "failure's.\n\n" +
    "A top-level task cannot move to complete until who reviewed and who tested it is known:\n" +
    "pass --reviewed-by and --tested-by (a person, or none for nobody) unless it already has\n" +
    "both answers. Subtasks are exempt.",
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
    "intesa task move WEB-12 complete --reviewed-by mei@example.com --tested-by @me",
  ],
  run: (ctx, { task, status }, flags) => moveTask(ctx, task, status as Status, flags),
  human: showTasks,
})

const shorthand = (name: string, status: Status, more: string[] = []) =>
  defineCommand({
    name,
    summary: `Move a task to ${STATUS_LABELS[status]}`,
    description: `Same as \`intesa task move TASK ${status}\`, with the same flags.`,
    args: [taskArg],
    flags: moveFlags,
    context: ["workspace", "project"],
    output: "taskMove",
    examples: [`intesa task ${name} WEB-12`, ...more],
    run: (ctx, { task }, flags) => moveTask(ctx, task, status, flags),
    human: showTasks,
  })

export const start = shorthand("start", "in_progress")
export const review = shorthand("review", "review")
export const done = shorthand("done", "complete", [
  "intesa task done WEB-12 --reviewed-by mei@example.com --tested-by none",
])

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
  return (await webLinks(ctx, task.project.workspaceId)).task((await res.json()).task)
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
  human: showTasks,
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
  human: showTasks,
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
  output: "deleted",
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
    ctx.done(`Deleted ${task.key}`)
    return { id: task.id, key: task.key, deleted: true }
  },
  human: () => "",
})
