import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { ApiError, client, unwrap } from "./api"

const artifacts = client.api.tasks[":taskId"].artifacts
export type Artifact = InferResponseType<typeof artifacts.$get>["artifacts"][number]
export const artifactUrl = (taskId: string, id?: string) =>
  `/api/tasks/${encodeURIComponent(taskId)}/artifacts${id ? `/${encodeURIComponent(id)}` : ""}`
const artifactKey = (taskId: string) => ["tasks", taskId, "artifacts"] as const

export const artifactsQuery = (taskId: string) =>
  queryOptions({
    queryKey: artifactKey(taskId),
    queryFn: async () => (await unwrap(artifacts.$get({ param: { taskId } }))).artifacts,
  })

export async function artifactText(taskId: string, id: string) {
  const res = await fetch(artifactUrl(taskId, id))
  if (!res.ok) {
    const error = await res.json().catch(() => null)
    throw new ApiError(
      res.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? "Could not load artifact.",
    )
  }
  return res.text()
}

export function useWriteArtifact(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, id }: { file: File; id?: string }) => {
      const body = new FormData()
      body.set("file", file)
      await unwrap(fetch(artifactUrl(taskId, id), { method: id ? "PUT" : "POST", body }))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: artifactKey(taskId) }),
  })
}
