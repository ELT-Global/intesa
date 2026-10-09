import { PRIORITIES, STATUSES } from "@intesa/api/schemas"
import { z } from "zod"
import { resolver } from "../../client/resolve"
import { askText } from "../../output/ask"
import { usageError } from "../../output/errors"
import { defineCommand } from "../../registry/define"
import {
  customFields,
  dueDate,
  linker,
  present,
  readBody,
  splitList,
  tagIds,
  taskArg,
  userIds,
} from "./shared"

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

const fieldFlag = z.array(z.string()).default([]).meta({
  placeholder: "NAME=VALUE",
  description: "Set a custom field; values are checked against the field's type",
})

export const create = defineCommand({
  name: "create",
  aliases: ["new"],
  summary: "Create a task",
  description:
    "Create a task in the current project, or a subtask with --parent. On a terminal a\n" +
    "missing title is asked for; otherwise -T is required.\n\n" +
    "People are emails, names or @me; tags are names. Unknown tags are an error unless\n" +
    "--create-tags is given. Custom field values are checked locally: numbers, true/false,\n" +
    "YYYY-MM-DD dates and the options of a select field.",
  flags: z.object({
    ...textFlags,
    status: z
      .enum(STATUSES)
      .optional()
      .meta({ short: "s", placeholder: "status", description: "Status (default todo)" }),
    priority: z
      .enum(PRIORITIES)
      .optional()
      .meta({ placeholder: "priority", description: "Priority" }),
    due: z.string().optional().meta({ placeholder: "YYYY-MM-DD", description: "Due date" }),
    assignee: z.array(z.string()).default([]).meta({
      short: "a",
      placeholder: "person",
      description: "Assign people: @me, an email or a name",
    }),
    tag: z
      .array(z.string())
      .default([])
      .meta({ short: "t", placeholder: "tag", description: "Add tags" }),
    createTags: z
      .boolean()
      .default(false)
      .meta({ description: "Create tags that do not exist yet" }),
    parent: z
      .string()
      .optional()
      .meta({ placeholder: "TASK", description: "Create a subtask of this task, in its project" }),
    field: fieldFlag,
  }),
  context: ["workspace", "project"],
  output: "task",
  examples: [
    'intesa task create -T "Fix login redirect" -a @me -t auth --priority high',
    'intesa task create --parent WEB-12 -T "Write tests"',
    "intesa task create -p WEB -T Notes -F notes.md --field Estimate=3",
  ],
  async run(ctx, _args, flags) {
    const title =
      flags.title ??
      (await askText(ctx, {
        flag: "--title",
        message: "Title",
        validate: (v) => (v.trim() ? undefined : "Enter a title"),
      }))
    const body = await readBody(ctx, flags)
    const dueAt = dueDate(flags.due)
    const r = resolver(ctx)
    const parent = flags.parent === undefined ? undefined : await r.task(flags.parent)
    // A subtask lives in its parent's project unless -p says otherwise (the server then
    // rejects the mismatch).
    const projectId = parent && !ctx.globals.project ? parent.projectId : (await r.project()).id
    const values = await customFields(ctx, projectId, flags.field)
    const assigneeIds = await userIds(ctx, splitList(flags.assignee))
    const tags = await tagIds(ctx, splitList(flags.tag), flags.createTags)

    const { client } = await ctx.http()
    const res = await client.api.projects[":projectId"].tasks.$post({
      param: { projectId },
      json: {
        title,
        status: flags.status,
        priority: flags.priority,
        dueAt,
        body,
        parentTaskId: parent?.id,
        ...(assigneeIds.length > 0 && { assigneeIds }),
        ...(tags.length > 0 && { tagIds: tags }),
      },
    })
    let { task } = await res.json()
    // Creation takes no custom field values; they follow in a second request.
    if (Object.keys(values).length > 0) {
      const patched = await client.api.tasks[":taskId"].$patch({
        param: { taskId: task.id },
        json: { customFields: values },
      })
      task = (await patched.json()).task
    }
    return present(ctx, (await linker(ctx))(task))
  },
})

export const edit = defineCommand({
  name: "edit",
  summary: "Change a task's title, description, priority, due date, people, tags or fields",
  description:
    "Change a task with one request. Assignees and tags are added and removed one by one;\n" +
    "the rest of the task is left as it is. Use `task move` to change the status.",
  args: [taskArg],
  flags: z.object({
    ...textFlags,
    priority: z
      .enum(PRIORITIES)
      .nullable()
      .optional()
      .meta({ placeholder: "priority", description: "Priority; --no-priority clears it" }),
    due: z
      .string()
      .nullable()
      .optional()
      .meta({ placeholder: "YYYY-MM-DD", description: "Due date; --no-due clears it" }),
    addAssignee: z
      .array(z.string())
      .default([])
      .meta({ placeholder: "person", description: "Assign someone" }),
    removeAssignee: z
      .array(z.string())
      .default([])
      .meta({ placeholder: "person", description: "Unassign someone" }),
    addTag: z.array(z.string()).default([]).meta({ placeholder: "tag", description: "Add a tag" }),
    removeTag: z
      .array(z.string())
      .default([])
      .meta({ placeholder: "tag", description: "Remove a tag" }),
    field: fieldFlag,
    clearField: z
      .array(z.string())
      .default([])
      .meta({ placeholder: "NAME", description: "Clear a custom field" }),
  }),
  context: ["workspace", "project"],
  output: "task",
  examples: [
    'intesa task edit WEB-12 -T "Fix the login redirect" --priority urgent',
    "intesa task edit WEB-12 --add-assignee @me --remove-tag blocked --no-due",
    "intesa task edit WEB-12 --field Estimate=5 --clear-field Stage",
  ],
  async run(ctx, { task: ref }, flags) {
    const people = flags.addAssignee.length > 0 || flags.removeAssignee.length > 0
    const labels = flags.addTag.length > 0 || flags.removeTag.length > 0
    const nothing =
      [flags.title, flags.body, flags.bodyFile, flags.priority, flags.due].every(
        (v) => v === undefined,
      ) &&
      !people &&
      !labels &&
      flags.field.length === 0 &&
      flags.clearField.length === 0
    // Without flags a person will get the task in $EDITOR here; for now it is an error.
    if (nothing) {
      throw usageError(
        "nothing to change: pass --title, --body, --priority, --due, --add-assignee, --add-tag, --field or another flag",
        "Run `intesa task edit --help` for every flag.",
      )
    }
    const body = await readBody(ctx, flags)
    const dueAt = dueDate(flags.due)
    const task = await resolver(ctx).task(ref)
    const values = await customFields(ctx, task.projectId, flags.field, flags.clearField)

    // The API replaces whole sets, so the new set is worked out from the current one.
    const nextSet = (current: string[], add: string[], remove: string[]) => {
      const gone = new Set(remove)
      return [...new Set([...current, ...add])].filter((id) => !gone.has(id))
    }
    const assigneeIds = people
      ? nextSet(
          task.assignees.map((a) => a.id),
          await userIds(ctx, splitList(flags.addAssignee)),
          await userIds(ctx, splitList(flags.removeAssignee)),
        )
      : undefined
    const nextTags = labels
      ? nextSet(
          task.tags.map((g) => g.id),
          await tagIds(ctx, splitList(flags.addTag)),
          await tagIds(ctx, splitList(flags.removeTag)),
        )
      : undefined

    const { client } = await ctx.http()
    const res = await client.api.tasks[":taskId"].$patch({
      param: { taskId: task.id },
      json: {
        title: flags.title,
        body,
        priority: flags.priority,
        dueAt,
        assigneeIds,
        tagIds: nextTags,
        ...(Object.keys(values).length > 0 && { customFields: values }),
      },
    })
    return present(ctx, (await linker(ctx))((await res.json()).task))
  },
})
