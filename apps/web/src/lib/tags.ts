import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client, unwrap } from "./api"

const workspaceTags = client.api.workspaces[":workspaceId"].tags
export type Tag = InferResponseType<typeof workspaceTags.$get>["tags"][number]

export const tagKeys = {
  list: (workspaceId: string) => ["tags", workspaceId] as const,
}

export const tagsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: tagKeys.list(workspaceId),
    queryFn: async () => (await unwrap(workspaceTags.$get({ param: { workspaceId } }))).tags,
  })

export function useCreateTag(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) =>
      (await unwrap(workspaceTags.$post({ param: { workspaceId }, json: { name } }))).tag,
    onSuccess: (tag) => {
      qc.setQueryData<Tag[]>(tagKeys.list(workspaceId), (old) => (old ? [...old, tag] : old))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: tagKeys.list(workspaceId) }),
  })
}
