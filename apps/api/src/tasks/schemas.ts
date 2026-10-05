import { z } from "zod"

export const STATUSES = ["backlog", "todo", "in_progress", "review", "complete"] as const
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const

const MAX_CUSTOM_FIELDS_PER_PATCH = 50

export type Status = (typeof STATUSES)[number]
export type Priority = (typeof PRIORITIES)[number]

const title = z.string().trim().min(1).max(200)
const body = z.string().max(20000)
const status = z.enum(STATUSES)
const priority = z.enum(PRIORITIES)
const ids = z.array(z.string().min(1)).max(100)

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

export const createTaskBody = z.object({
  title,
  status: status.default("todo"),
  priority: priority.nullish(),
  dueAt: dueAt.nullish(),
  body: body.nullish(),
  parentTaskId: z.string().min(1).nullish(),
  assigneeIds: ids.optional(),
  tagIds: ids.optional(),
})

export const patchTaskBody = z.object({
  title: title.optional(),
  body: body.nullable().optional(),
  status: status.optional(),
  priority: priority.nullable().optional(),
  dueAt: dueAt.nullable().optional(),
  assigneeIds: ids.optional(),
  tagIds: ids.optional(),
  customFields: z
    .record(z.string(), z.unknown())
    .refine((r) => Object.keys(r).length <= MAX_CUSTOM_FIELDS_PER_PATCH, "Too many custom fields")
    .optional(),
})

export type CreateTaskInput = z.infer<typeof createTaskBody>
export type PatchTaskInput = z.infer<typeof patchTaskBody>
