import type { PatchTaskInput } from "@intesa/api/schemas"
import { webLinks } from "../../client/links"
import { resolver } from "../../client/resolve"
import { editText } from "../../io/editor"
import { askYesNo, personPresent } from "../../io/prompt"
import { diffTaskDoc, parseTaskDoc, type TaskDoc, toTaskDoc } from "../../io/task-doc"
import { CliError, cancelled, formatError, usageError } from "../../output/errors"
import type { Ctx } from "../../registry/define"
import { withSubtaskSync } from "./move"
import { customFields, type TaskDetail, tagIds, userIds } from "./shared"

// The edit as one PATCH body. Names are resolved here, so a mistake fails before any write.
async function toPatch(ctx: Ctx, task: TaskDetail, change: Partial<TaskDoc>) {
  const fields = Object.entries(change.fields ?? {})
  const values = await customFields(
    ctx,
    task.projectId,
    fields.filter(([, v]) => v !== null).map(([name, v]) => `${name}=${v}`),
    fields.filter(([, v]) => v === null).map(([name]) => name),
  )
  const patch: PatchTaskInput = {
    title: change.title,
    status: change.status,
    priority: change.priority,
    dueAt: change.due,
    body: change.body === undefined ? undefined : change.body || null,
    assigneeIds: change.assignees && (await userIds(ctx, change.assignees)),
    tagIds: change.tags && (await tagIds(ctx, change.tags)),
    ...(fields.length > 0 && { customFields: values }),
  }
  return patch
}

// `task edit TASK` without flags: the task as a front-matter document in the editor, and what
// changed in it saved with one PATCH. A person who made a mistake (a bad value, an unknown
// name) may go back to the editor; anyone else gets the error. INTESA_EDITOR is how a script
// opts in.
export async function editTaskDoc(ctx: Ctx, ref: string) {
  const interactive = personPresent(ctx)
  if (!interactive && !ctx.env.INTESA_EDITOR?.trim()) {
    throw usageError(
      "nothing to change: pass --title, --body, --priority, --due, --add-assignee, --add-tag, --field or another flag",
      "Run `intesa task edit --help` for every flag, or set INTESA_EDITOR to edit the task as a document.",
    )
  }
  const r = resolver(ctx)
  const task = await r.task(ref)
  const [me, members, fields] = await Promise.all([r.me(), r.members(), r.fields(task.projectId)])
  const original = toTaskDoc(task, { meId: me.id, members, fields })
  const before = parseTaskDoc(original)
  const linked = (await webLinks(ctx, task.project.workspaceId)).task

  let text = original
  let patch: PatchTaskInput
  for (;;) {
    text = await editText(text, {
      filename: `${task.key}.md`,
      env: ctx.env,
      configEditor: ctx.config.editor,
      interactive,
    })
    try {
      const change = diffTaskDoc(before, parseTaskDoc(text))
      if (Object.keys(change).length === 0) {
        ctx.stderr("No changes\n")
        return linked(task)
      }
      patch = await toPatch(ctx, task, change)
      break
    } catch (err) {
      // Input mistakes only; a network or server failure is not fixed by editing.
      if (!interactive || !(err instanceof CliError) || ![2, 5].includes(err.exitCode)) throw err
      ctx.stderr(formatError(err, false))
      if (!(await askYesNo("Edit the task again?"))) throw cancelled()
    }
  }

  const { client } = await ctx.http()
  const res = await client.api.tasks[":taskId"].$patch({ param: { taskId: task.id }, json: patch })
  const saved = linked((await res.json()).task)
  // A status change brings subtasks along as `task move` does.
  return patch.status ? withSubtaskSync(ctx, task, patch.status, saved, undefined) : saved
}
