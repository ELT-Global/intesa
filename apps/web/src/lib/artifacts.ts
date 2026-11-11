import { artifactFileError } from "@intesa/api/artifacts"
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { useCallback, useEffect, useRef } from "react"
import { notify } from "@/components/mutation-error-notice"
import { ApiError, client, keys, unwrap } from "./api"
import { removeImage, replaceUrl } from "./markdown-images"

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

async function sendFile(taskId: string, file: File, id?: string) {
  const body = new FormData()
  body.set("file", file)
  const res = await unwrap(fetch(artifactUrl(taskId, id), { method: id ? "PUT" : "POST", body }))
  return (res as { artifact: Artifact }).artifact
}

export function useWriteArtifact(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, id }: { file: File; id?: string }) => sendFile(taskId, file, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: artifactKey(taskId) }),
  })
}

export function useDeleteArtifact(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(artifacts[":artifactId"].$delete({ param: { taskId, artifactId: id } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: artifactKey(taskId) })
      void qc.invalidateQueries({ queryKey: keys.storage })
    },
  })
}

/**
 * Stores an image pasted or dropped into a task's Markdown and resolves to its id and URL. A
 * rejected file is reported as a notice; the editor then drops its placeholder.
 */
export function useUploadImage(taskId: string) {
  const write = useWriteArtifact(taskId)
  return async (file: File) => {
    try {
      const invalid = artifactFileError(file)
      if (invalid) throw new Error(invalid)
      const artifact = await write.mutateAsync({ file })
      return { id: artifact.id, url: artifactUrl(taskId, artifact.id) }
    } catch (err) {
      notify(
        `${file.name}: ${err instanceof Error ? err.message : "Could not upload the image."}`,
        "error",
      )
      throw err
    }
  }
}

/**
 * Images pasted or dropped into the Markdown of a task that does not exist yet. Each is checked,
 * then shown from a blob: URL of this page; `upload` stores the ones the Markdown still shows
 * once the task is created.
 */
export function useHeldImages() {
  const held = useRef(new Map<string, File>())
  const clear = useCallback(() => {
    for (const url of held.current.keys()) URL.revokeObjectURL(url)
    held.current.clear()
  }, [])
  useEffect(() => clear, [clear])

  const hold = useCallback(async (file: File) => {
    const invalid = artifactFileError(file)
    if (invalid) {
      notify(`${file.name}: ${invalid}`, "error")
      throw new Error(invalid)
    }
    const url = URL.createObjectURL(file)
    held.current.set(url, file)
    return url
  }, [])

  /** The held images `markdown` shows. */
  const shown = (markdown: string) => [...held.current].filter(([url]) => markdown.includes(url))

  return {
    hold,
    clear,
    /** Whether `markdown` shows a held image. */
    shows: (markdown: string) => shown(markdown).length > 0,
    /** `markdown` without its held images, to save before they are uploaded. */
    without: (markdown: string) =>
      shown(markdown)
        .reduce((md, [url]) => removeImage(md, url), markdown)
        .trim(),
    /**
     * Uploads the held images `markdown` shows to the task and returns `markdown` pointing at
     * them. An image that is refused is reported and left out.
     */
    async upload(taskId: string, markdown: string) {
      const results = await Promise.allSettled(
        shown(markdown).map(async ([url, file]) => {
          try {
            return { url, stored: artifactUrl(taskId, (await sendFile(taskId, file)).id) }
          } catch (err) {
            notify(
              `${file.name}: ${err instanceof Error ? err.message : "Could not upload the image."}`,
              "error",
            )
            throw err
          }
        }),
      )
      let next = markdown
      shown(markdown).forEach(([url], i) => {
        const result = results[i]
        next =
          result?.status === "fulfilled"
            ? replaceUrl(next, url, result.value.stored)
            : removeImage(next, url)
      })
      return next.trim()
    },
  }
}
