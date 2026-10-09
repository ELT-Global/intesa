import { PRIORITIES, STATUSES } from "@intesa/api/schemas"
import { z } from "zod"
import { webLinks } from "../../client/links"
import { resolver } from "../../client/resolve"
import { isInteractive } from "../../io/prompt"
import { usageError } from "../../output/errors"
import { defineCommand } from "../../registry/define"
import {
  customFields,
  dueDate,
  readBody,
  showTasks,
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

const createTags = z
  .boolean()
  .default(false)
  .meta({ description: "Create tags that do not exist yet" })

const fieldFlag = z.array(z.string()).default([]).meta({
  placeholder: "NAME=VALUE",
  description: "Set a custom field; values are checked against the field's type",
})

export const create = defineCommand({
  name: "create",
  aliases: ["new"],
  summary: "Create a task",
  description:
    "Create a task in the current project, or a subtask with --parent. On a terminal,\n" +
    "without -T a form asks for the title and whatever else was not given as a flag:\n" +
    "status, priority, people, tags, due date and the description. Otherwise -T is required.\n\n" +
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
    createTags,
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
    // Without a title a person fills in the rest too, in a form like the web's dialog.
    if (flags.title === undefined && !isInteractive(ctx)) {
      throw usageError("missing --title (required when not interactive)")
    }
    // The flags are checked first, so a typo in one does not throw away a filled-in form.
    dueDate(flags.due)
    const given = await readBody(ctx, flags)
    const r = resolver(ctx)
    const parent = flags.parent === undefined ? undefined : await r.task(flags.parent)
    // A subtask lives in its parent's project unless -p says otherwise (the server then
    // rejects the mismatch).
    const project = parent && !ctx.globals.project ? parent.project : await r.project()
    const projectId = project.id
    const values = await customFields(ctx, projectId, flags.field)
    const people = await userIds(ctx, splitList(flags.assignee))

    const form =
      flags.title === undefined ? await (await import("./form")).createForm(ctx, flags) : undefined
    const title = flags.title ?? form?.title ?? ""
    const body = form?.body ?? given
    const dueAt = dueDate(flags.due ?? form?.due)
    const assigneeIds = [...people, ...(await userIds(ctx, form?.assignees ?? []))]
    // Tags named in the form were picked or typed as new ones, so they are created.
    const tags = await tagIds(
      ctx,
      [...splitList(flags.tag), ...(form?.tags ?? [])],
      flags.createTags || (form?.tags.length ?? 0) > 0,
    )

    const { client } = await ctx.http()
    const res = await client.api.projects[":projectId"].tasks.$post({
      param: { projectId },
      json: {
        title,
        status: flags.status ?? form?.status,
        priority: flags.priority ?? form?.priority,
        dueAt,
        body,
        parentTaskId: parent?.id,
        ...(assigneeIds.length > 0 && { assigneeIds }),
        ...(tags.length > 0 && { tagIds: tags }),
        ...(Object.keys(values).length > 0 && { customFields: values }),
      },
    })
    return (await webLinks(ctx, project.workspaceId)).task((await res.json()).task)
  },
  human: showTasks,
})

export const edit = defineCommand({
  name: "edit",
  summary: "Change a task's title, description, priority, due date, people, tags or fields",
  description:
    "Change a task with one request. Assignees and tags are added and removed one by one;\n" +
    "the rest of the task is left as it is. Use `task move` to change the status.\n\n" +
    "Without flags the task opens in your editor as a document: its properties between\n" +
    "--- lines, then the description.\n\n" +
    "  ---\n" +
    "  title: Fix login redirect\n" +
    "  status: in_progress\n" +
    "  priority: high\n" +
    "  due: 2026-10-15\n" +
    "  assignees: [Mei Chen, @me]\n" +
    "  tags: [auth, bug]\n" +
    "  fields: { Estimate: 3 }\n" +
    "  ---\n" +
    "  The description, in Markdown.\n\n" +
    "What changed is saved with one request; a status change then treats subtasks as\n" +
    "`task move` does. An empty value clears. Without a terminal this needs INTESA_EDITOR, a\n" +
    "command that edits the file it is given and exits.",
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
    createTags,
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
    "intesa task edit WEB-12",
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
    // Without flags the task opens in the editor, for a person or with INTESA_EDITOR set.
    if (nothing) return (await import("./doc")).editTaskDoc(ctx, ref)
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
          await tagIds(ctx, splitList(flags.addTag), flags.createTags),
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
    return (await webLinks(ctx, task.project.workspaceId)).task((await res.json()).task)
  },
  human: showTasks,
})
