import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { client, keys, unwrap } from "./api"
import { uploadImage } from "./artifacts"
import { invalidateTaskGraph } from "./tasks"

const bugById = client.api.bugs[":bugId"]
const projectBugs = client.api.projects[":projectId"].bugs

export type BugSummary = InferResponseType<typeof projectBugs.$get>["bugs"][number]
export type BugDetail = InferResponseType<(typeof bugById)["$get"]>["bug"]
export type BugStatus = BugSummary["status"]

// Under one prefix, so any task change can mark every bug view stale (see invalidateTaskGraph).
export const bugKeys = {
  all: ["bugs"] as const,
  project: (projectId: string) => ["bugs", "project", projectId] as const,
  list: (projectId: string, status?: BugStatus) =>
    [...bugKeys.project(projectId), status ?? "all"] as const,
  detail: (bugId: string) => ["bugs", bugId] as const,
}

export const projectBugsQuery = (projectId: string, status?: BugStatus) =>
  queryOptions({
    queryKey: bugKeys.list(projectId, status),
    queryFn: async () =>
      (await unwrap(projectBugs.$get({ param: { projectId }, query: { status } }))).bugs,
  })

export const bugQuery = (bugId: string) =>
  queryOptions({
    queryKey: bugKeys.detail(bugId),
    queryFn: async () => (await unwrap(bugById.$get({ param: { bugId } }))).bug,
  })

function useSetBug() {
  const qc = useQueryClient()
  return (bug: BugDetail) => {
    qc.setQueryData(bugKeys.detail(bug.id), bug)
    void qc.invalidateQueries({ queryKey: bugKeys.project(bug.projectId) })
  }
}

/** Edits a bug's own title or description; its tasks are never changed. */
export function useUpdateBug(bugId: string) {
  const qc = useQueryClient()
  const setBug = useSetBug()
  return useMutation({
    meta: { errorNotice: "Could not save the bug." },
    mutationFn: async (patch: { title?: string; body?: string | null }) =>
      (await unwrap(bugById.$patch({ param: { bugId }, json: patch }))).bug,
    onSuccess: (bug) => {
      setBug(bug)
      // Task details show their bug's title.
      void qc.invalidateQueries({ queryKey: ["tasks"] })
    },
  })
}

/** Opens a regression task against a resolved bug; resolves to the new task. */
export function useOpenRegression(bugId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorNotice: "Could not open the regression task." },
    mutationFn: async () => unwrap(bugById.tasks.$post({ param: { bugId }, json: {} })),
    // Not settleTaskMutation: this has no optimistic task state of its own to protect. The graph
    // refresh also refetches the bug, so it is not written to the cache first.
    onSuccess: ({ bug }) => invalidateTaskGraph(qc, bug.projectId),
  })
}

export const bugImageUrl = (bugId: string, imageId: string) =>
  `/api/bugs/${encodeURIComponent(bugId)}/images/${encodeURIComponent(imageId)}`

/** Stores an image pasted or dropped into a bug's description and resolves to its URL. */
export function useUploadBugImage(bugId: string) {
  return (file: File) =>
    uploadImage(file, async () => {
      const body = new FormData()
      body.set("file", file)
      const res = await unwrap(
        fetch(`/api/bugs/${encodeURIComponent(bugId)}/images`, { method: "POST", body }),
      )
      const { image } = res as { image: { id: string } }
      return { id: image.id, url: bugImageUrl(bugId, image.id) }
    })
}

/** Deletes a bug image that never reached a saved description. */
export function useDeleteBugImage(bugId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (imageId: string) =>
      unwrap(bugById.images[":imageId"].$delete({ param: { bugId, imageId } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.storage }),
  })
}

/** What a bug's status badge says: a pending bug that has come back is "regressed". */
export type BugState = BugStatus | "regressed"

export const bugState = (bug: { status: BugStatus; regressions?: number }): BugState =>
  bug.status === "pending" && (bug.regressions ?? 0) > 0 ? "regressed" : bug.status

/** Whether the bug's key or title, or any of its tasks' keys or titles, contain `query`. */
export function bugMatches(bug: BugSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [bug, ...bug.tasks].some(
    (x) => x.key.toLowerCase().includes(q) || x.title.toLowerCase().includes(q),
  )
}
