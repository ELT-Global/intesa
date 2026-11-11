import { z } from "zod"
import { createTaskBody, patchTaskBody } from "../tasks/schemas"

export const BUG_STATUSES = ["pending", "resolved"] as const
export type BugStatus = (typeof BUG_STATUSES)[number]

// A bug's key is its project key, B and its number (WEB-B3); people type it in any case.
export const BUG_KEY_PATTERN = /^([A-Z][A-Z0-9]{1,4})-B([1-9]\d{0,8})$/i

export const patchBugBody = patchTaskBody.pick({ title: true, body: true })

// A regression task takes what a new task does; its title defaults to the bug's.
export const regressionTaskBody = createTaskBody.partial({ title: true })

export const listBugsQuery = z.object({ status: z.enum(BUG_STATUSES).optional() })

export type PatchBugInput = z.infer<typeof patchBugBody>
export type RegressionTaskInput = z.infer<typeof regressionTaskBody>
