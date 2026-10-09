import { confirm, isCancel, multiselect, select, text } from "@clack/prompts"
import { isRealDate, PRIORITIES, type Priority, STATUSES, type Status } from "@intesa/api/schemas"
import { PRIORITY_LABELS, STATUS_LABELS } from "@intesa/task-query"
import { resolver } from "../../client/resolve"
import { editText } from "../../io/editor"
import { cancelled } from "../../output/errors"
import type { Ctx } from "../../registry/define"
import { splitList } from "./shared"

export type CreateAnswers = {
  title: string
  status?: Status
  priority?: Priority
  due?: string
  // User ids, and tag ids or the names of tags to create.
  assignees: string[]
  tags: string[]
  body?: string
}

const NEW_TAG = "\0new"
const output = process.stderr

function answer<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) throw cancelled()
  return value as Exclude<T, symbol>
}

// The web's create dialog as prompts, for a person who ran `task create` without -T. What
// was given as flags is not asked again.
export async function createForm(
  ctx: Ctx,
  given: {
    status?: Status
    priority?: Priority
    due?: string
    assignee: string[]
    tag: string[]
    body?: string
    bodyFile?: string
  },
): Promise<CreateAnswers> {
  const r = resolver(ctx)
  const title = answer(
    await text({
      message: "Title",
      validate: (v) => (v?.trim() ? undefined : "Enter a title"),
      output,
    }),
  ).trim()

  const status =
    given.status ??
    answer(
      await select<Status>({
        message: "Status",
        options: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
        initialValue: "todo",
        output,
      }),
    )

  const priority =
    given.priority ??
    answer(
      await select<Priority | "none">({
        message: "Priority",
        options: [
          { value: "none", label: "No priority" },
          ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })),
        ],
        initialValue: "none",
        output,
      }),
    )

  let assignees: string[] = []
  if (given.assignee.length === 0) {
    const [me, members] = await Promise.all([r.me(), r.members()])
    assignees = answer(
      await multiselect({
        message: "Assignees",
        options: members.map((m) => ({
          value: m.userId,
          label: m.userId === me.id ? `${m.name} (you)` : m.name,
          hint: m.email,
        })),
        required: false,
        output,
      }),
    )
  }

  let tags: string[] = []
  if (given.tag.length === 0) {
    const existing = await r.tags()
    tags = answer(
      await multiselect({
        message: "Tags",
        options: [
          ...existing.map((t) => ({ value: t.id, label: t.name })),
          { value: NEW_TAG, label: "New tag…" },
        ],
        required: false,
        output,
      }),
    )
    if (tags.includes(NEW_TAG)) {
      const names = answer(await text({ message: "New tags, separated by commas", output }))
      tags = [...tags.filter((t) => t !== NEW_TAG), ...splitList([names ?? ""])]
    }
  }

  const due =
    given.due ??
    answer(
      await text({
        message: "Due date (YYYY-MM-DD, empty for none)",
        validate: (v) =>
          !v?.trim() || isRealDate(v.trim()) ? undefined : "Use YYYY-MM-DD, e.g. 2026-10-15",
        output,
      }),
    )?.trim()

  let body: string | undefined
  if (given.body === undefined && given.bodyFile === undefined) {
    const write = answer(
      await confirm({
        message: "Write a description in your editor?",
        initialValue: false,
        output,
      }),
    )
    if (write) {
      body = await editText("", {
        filename: "description.md",
        env: ctx.env,
        configEditor: ctx.config.editor,
        interactive: true,
      })
    }
  }

  return {
    title,
    status,
    priority: priority === "none" ? undefined : priority,
    due: due || undefined,
    assignees,
    tags,
    body: body?.trim() ? body : undefined,
  }
}
