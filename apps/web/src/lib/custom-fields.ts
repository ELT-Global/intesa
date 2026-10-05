import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferRequestType, InferResponseType } from "hono/client"
import { client, unwrap } from "./api"
import { taskKeys } from "./tasks"

const projectFields = client.api.projects[":projectId"]["custom-fields"]
const fieldById = client.api["custom-fields"][":fieldId"]

export type CustomField = InferResponseType<typeof projectFields.$get>["fields"][number]
export type FieldType = CustomField["type"]
export type CreateFieldInput = InferRequestType<typeof projectFields.$post>["json"]
export type FieldPatch = InferRequestType<(typeof fieldById)["$patch"]>["json"]

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Checkbox",
  date: "Date",
  select: "Select",
}

export const fieldKeys = {
  list: (projectId: string) => ["projects", projectId, "custom-fields"] as const,
}

export const customFieldsQuery = (projectId: string) =>
  queryOptions({
    queryKey: fieldKeys.list(projectId),
    queryFn: async () => (await unwrap(projectFields.$get({ param: { projectId } }))).fields,
    staleTime: 60_000,
  })

/** Definitions change what task details contain (removed options clear values), so details refetch too. */
export function useFieldMutations(projectId: string) {
  const qc = useQueryClient()
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: fieldKeys.list(projectId) }),
      qc.invalidateQueries({ queryKey: ["tasks"] }),
      qc.invalidateQueries({ queryKey: taskKeys.list(projectId) }),
    ])
  }
  return {
    create: useMutation({
      mutationFn: (json: CreateFieldInput) =>
        unwrap(projectFields.$post({ param: { projectId }, json })),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ fieldId, json }: { fieldId: string; json: FieldPatch }) =>
        unwrap(fieldById.$patch({ param: { fieldId }, json })),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (fieldId: string) => unwrap(fieldById.$delete({ param: { fieldId } })),
      onSuccess: refresh,
    }),
  }
}
