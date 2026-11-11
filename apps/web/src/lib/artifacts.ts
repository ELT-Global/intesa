import { artifactFileError } from "@intesa/api/artifacts"
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { notify } from "@/components/mutation-error-notice"
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
      const res = await unwrap(
        fetch(artifactUrl(taskId, id), { method: id ? "PUT" : "POST", body }),
      )
      return (res as { artifact: Artifact }).artifact
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: artifactKey(taskId) }),
  })
}

/**
 * Stores an image pasted or dropped into a task's Markdown and resolves to its URL. A rejected
 * file is reported as a notice; the editor then drops its placeholder.
 */
export function useUploadImage(taskId: string) {
  const write = useWriteArtifact(taskId)
  return async (file: File) => {
    try {
      const invalid = artifactFileError(file)
      if (invalid) throw new Error(invalid)
      const artifact = await write.mutateAsync({ file })
      return artifactUrl(taskId, artifact.id)
    } catch (err) {
      notify(
        `${file.name}: ${err instanceof Error ? err.message : "Could not upload the image."}`,
        "error",
      )
      throw err
    }
  }
}
