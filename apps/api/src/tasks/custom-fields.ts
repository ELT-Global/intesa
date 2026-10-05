import type { Selectable } from "kysely"
import { type Db, inTransaction, newId, now } from "../db"
import type { CustomFieldDefinitionTable } from "../db/schema"
import { ApiError } from "../lib/errors"
import { isRealDate } from "./schemas"

export const FIELD_TYPES = ["text", "number", "boolean", "date", "select"] as const
export type FieldType = (typeof FIELD_TYPES)[number]

type FieldRow = Selectable<CustomFieldDefinitionTable>

export type CustomFieldJson = {
  id: string
  projectId: string
  name: string
  type: FieldType
  required: boolean
  options: string[]
  position: number
}

export const toFieldJson = (f: FieldRow): CustomFieldJson => ({
  id: f.id,
  projectId: f.projectId,
  name: f.name,
  type: f.type as FieldType,
  required: f.required === 1,
  options: f.options ? (JSON.parse(f.options) as string[]) : [],
  position: f.position,
})

export const listFields = async (db: Db, projectId: string): Promise<CustomFieldJson[]> =>
  (
    await db
      .selectFrom("customFieldDefinitions")
      .selectAll()
      .where("projectId", "=", projectId)
      .orderBy("position")
      .orderBy("createdAt")
      .execute()
  ).map(toFieldJson)

// Authorization for field routes: member of the owning project's workspace, else NOT_FOUND.
export async function requireField(db: Db, userId: string, fieldId: string): Promise<FieldRow> {
  const row = await db
    .selectFrom("customFieldDefinitions")
    .innerJoin("projects", "projects.id", "customFieldDefinitions.projectId")
    .leftJoin("workspaceMembers", (join) =>
      join
        .onRef("workspaceMembers.workspaceId", "=", "projects.workspaceId")
        .on("workspaceMembers.userId", "=", userId),
    )
    .selectAll("customFieldDefinitions")
    .select("workspaceMembers.role")
    .where("customFieldDefinitions.id", "=", fieldId)
    .executeTakeFirst()
  if (!row?.role) throw new ApiError("NOT_FOUND", "Field not found")
  const { role: _role, ...field } = row
  return field
}

async function assertNameFree(db: Db, projectId: string, name: string, exceptId?: string) {
  const rows = await db
    .selectFrom("customFieldDefinitions")
    .select(["id", "name"])
    .where("projectId", "=", projectId)
    .execute()
  if (rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase())) {
    throw new ApiError("CONFLICT", "A field with that name already exists")
  }
}

export async function createField(
  db: Db,
  projectId: string,
  input: { name: string; type: FieldType; required?: boolean; options?: string[] },
): Promise<CustomFieldJson> {
  const options = input.type === "select" ? (input.options ?? []) : []
  if (input.type === "select" && options.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "options: a select field needs at least one option")
  }
  if (input.type !== "select" && input.options?.length) {
    throw new ApiError("VALIDATION_ERROR", "options: only select fields have options")
  }
  return inTransaction(db, async (trx) => {
    await assertNameFree(trx, projectId, input.name)
    const last = await trx
      .selectFrom("customFieldDefinitions")
      .select((eb) => eb.fn.max("position").as("max"))
      .where("projectId", "=", projectId)
      .executeTakeFirst()
    const row = await trx
      .insertInto("customFieldDefinitions")
      .values({
        id: newId(),
        projectId,
        name: input.name,
        type: input.type,
        required: input.required ? 1 : 0,
        options: input.type === "select" ? JSON.stringify(options) : null,
        position: last?.max === null || last?.max === undefined ? 0 : Number(last.max) + 1,
        createdAt: now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    return toFieldJson(row)
  })
}

export async function updateField(
  db: Db,
  field: FieldRow,
  patch: { name?: string; required?: boolean; options?: string[] },
): Promise<CustomFieldJson> {
  if (patch.options && field.type !== "select") {
    throw new ApiError("VALIDATION_ERROR", "options: only select fields have options")
  }
  if (patch.options && patch.options.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "options: a select field needs at least one option")
  }
  return inTransaction(db, async (trx) => {
    if (patch.name) await assertNameFree(trx, field.projectId, patch.name, field.id)
    const row = await trx
      .updateTable("customFieldDefinitions")
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.required !== undefined && { required: patch.required ? 1 : 0 }),
        ...(patch.options !== undefined && { options: JSON.stringify(patch.options) }),
      })
      .where("id", "=", field.id)
      .returningAll()
      .executeTakeFirstOrThrow()

    if (patch.options) {
      // Values pointing at a removed option would be invalid, so they are cleared with the edit.
      const allowed = new Set(patch.options)
      const values = await trx
        .selectFrom("taskCustomFieldValues")
        .select(["taskId", "value"])
        .where("fieldId", "=", field.id)
        .execute()
      const stale = values.filter((v) => !allowed.has(JSON.parse(v.value) as string))
      if (stale.length > 0) {
        await trx
          .deleteFrom("taskCustomFieldValues")
          .where("fieldId", "=", field.id)
          .where(
            "taskId",
            "in",
            stale.map((v) => v.taskId),
          )
          .execute()
      }
    }
    return toFieldJson(row)
  })
}

function invalid(field: FieldRow, message: string): never {
  throw new ApiError("VALIDATION_ERROR", `customFields.${field.name}: ${message}`)
}

// Returns the value in the form it is stored (before JSON encoding).
export function validateFieldValue(field: FieldRow, value: unknown): string | number | boolean {
  switch (field.type as FieldType) {
    case "text":
      if (typeof value !== "string") return invalid(field, "expected text")
      if (value.length > 2000) return invalid(field, "at most 2000 characters")
      return value
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return invalid(field, "expected a finite number")
      }
      return value
    case "boolean":
      if (typeof value !== "boolean") return invalid(field, "expected true or false")
      return value
    case "date":
      if (typeof value !== "string" || !isRealDate(value)) {
        return invalid(field, "expected a date as YYYY-MM-DD")
      }
      return value
    case "select": {
      const options = field.options ? (JSON.parse(field.options) as string[]) : []
      if (typeof value !== "string" || !options.includes(value)) {
        return invalid(field, "not one of the field's options")
      }
      return value
    }
  }
}

// Applies a customFields patch to a task: validates every entry first, then writes.
// Call inside the task update's transaction so a bad value rolls back the whole PATCH.
export async function applyCustomFields(
  db: Db,
  task: { id: string; projectId: string },
  values: Record<string, unknown>,
): Promise<void> {
  const fieldIds = Object.keys(values)
  if (fieldIds.length === 0) return

  const [fields, existing] = await Promise.all([
    db
      .selectFrom("customFieldDefinitions")
      .selectAll()
      .where("id", "in", fieldIds)
      .where("projectId", "=", task.projectId)
      .execute(),
    db
      .selectFrom("taskCustomFieldValues")
      .select("fieldId")
      .where("taskId", "=", task.id)
      .where("fieldId", "in", fieldIds)
      .execute(),
  ])
  const byId = new Map(fields.map((f) => [f.id, f]))
  const hasValue = new Set(existing.map((e) => e.fieldId))

  const writes: { fieldId: string; value: string | null }[] = []
  for (const [fieldId, raw] of Object.entries(values)) {
    const field = byId.get(fieldId)
    if (!field) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `customFields: unknown field for this project: ${fieldId}`,
      )
    }
    if (raw === null) {
      if (field.required === 1 && hasValue.has(fieldId)) {
        return invalid(field, "required fields cannot be cleared")
      }
      writes.push({ fieldId, value: null })
    } else {
      writes.push({ fieldId, value: JSON.stringify(validateFieldValue(field, raw)) })
    }
  }

  for (const { fieldId, value } of writes) {
    await db
      .deleteFrom("taskCustomFieldValues")
      .where("taskId", "=", task.id)
      .where("fieldId", "=", fieldId)
      .execute()
    if (value !== null) {
      await db
        .insertInto("taskCustomFieldValues")
        .values({ taskId: task.id, fieldId, value })
        .execute()
    }
  }
}

export async function loadCustomFieldValues(
  db: Db,
  taskId: string,
): Promise<Record<string, unknown>> {
  const rows = await db
    .selectFrom("taskCustomFieldValues")
    .select(["fieldId", "value"])
    .where("taskId", "=", taskId)
    .execute()
  return Object.fromEntries(rows.map((r) => [r.fieldId, JSON.parse(r.value)]))
}
