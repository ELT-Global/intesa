import { z } from "zod"

export const STATUSES = ["backlog", "todo", "in_progress", "review", "complete"] as const
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const

const MAX_CUSTOM_FIELDS = 50

export const FIELD_TYPES = ["text", "number", "boolean", "date", "select"] as const
// blocked_by is the reverse view of blocks; it is accepted on input and never stored.
export const RELATION_TYPES = ["blocks", "blocked_by", "related"] as const

export type FieldType = (typeof FIELD_TYPES)[number]
export type RelationType = (typeof RELATION_TYPES)[number]
export type Status = (typeof STATUSES)[number]
export type Priority = (typeof PRIORITIES)[number]

const title = z.string().trim().min(1).max(200)
const body = z.string().max(20000)
const status = z.enum(STATUSES)
const priority = z.enum(PRIORITIES)
const ids = z.array(z.string().min(1)).max(100)
// Values by field id; each is checked against its field when the task is written.
const customFields = z
  .record(z.string(), z.unknown())
  .refine((r) => Object.keys(r).length <= MAX_CUSTOM_FIELDS, "Too many custom fields")

// YYYY-MM-DD that is a real calendar date (rejects 2026-02-31).
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
}

const dueAt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(isRealDate, "Not a valid date")

// What the API says when a top-level task is completed before both questions are answered;
// clients recognise the error by it.
export const SIGNOFF_REQUIRED =
  "Record who reviewed and who tested a task before completing it (reviewedById, testedById; null for nobody)"

// Who reviewed / tested the task: a member's id, or null for nobody. Omitted leaves the
// answer as it is (unanswered, for a new task).
const signoff = z.string().min(1).nullable().optional()

export const createTaskBody = z.object({
  title,
  status: status.default("todo"),
  priority: priority.nullish(),
  dueAt: dueAt.nullish(),
  body: body.nullish(),
  parentTaskId: z.string().min(1).nullish(),
  assigneeIds: ids.optional(),
  tagIds: ids.optional(),
  reviewedById: signoff,
  testedById: signoff,
  customFields: customFields.optional(),
})

// Where to put the task among the others in its column (the one it is in after this patch):
// next to another task of that column, or at either end.
const placement = z.union([
  z.strictObject({ before: z.string().min(1) }),
  z.strictObject({ after: z.string().min(1) }),
  z.enum(["first", "last"]),
])

export const patchTaskBody = z.object({
  title: title.optional(),
  body: body.nullable().optional(),
  status: status.optional(),
  // Without it a task whose status changes goes to the top of the new column.
  placement: placement.optional(),
  priority: priority.nullable().optional(),
  dueAt: dueAt.nullable().optional(),
  assigneeIds: ids.optional(),
  tagIds: ids.optional(),
  reviewedById: signoff,
  testedById: signoff,
  customFields: customFields.optional(),
})

export type CreateTaskInput = z.infer<typeof createTaskBody>
export type PatchTaskInput = z.infer<typeof patchTaskBody>
