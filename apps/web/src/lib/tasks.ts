import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferRequestType, InferResponseType } from "hono/client"
import { ApiError, client, unwrap } from "./api"

const taskById = client.api.tasks[":taskId"]
const projectTasks = client.api.projects[":projectId"].tasks

export type TaskSummary = InferResponseType<typeof projectTasks.$get>["tasks"][number]
export type TaskDetail = InferResponseType<(typeof taskById)["$get"]>["task"]
export type HistoryEntry = InferResponseType<(typeof taskById.history)["$get"]>["history"][number]
export type TaskRef = TaskDetail["blocks"][number]
export type RelationType = InferRequestType<
  (typeof taskById.relationships)["$post"]
>["json"]["type"]
export type UserRef = TaskSummary["assignees"][number]
export type TagRef = TaskSummary["tags"][number]

export type TaskStatus = TaskSummary["status"]
export type TaskPriority = NonNullable<TaskSummary["priority"]>
export const TASK_STATUSES: readonly TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "complete",
]
export const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"]

export type CreateTaskInput = InferRequestType<typeof projectTasks.$post>["json"]
export type TaskPatch = InferRequestType<(typeof taskById)["$patch"]>["json"]

/** Resolved people/tags matching a patch's id sets, so the cache can update before the server answers. */
export type TaskPatchView = {
  assignees?: UserRef[]
  tags?: TagRef[]
  customFields?: Record<string, unknown>
}

const taskApi = {
  list: (projectId: string) => unwrap(projectTasks.$get({ param: { projectId } })),
  get: (taskId: string) => unwrap(taskById.$get({ param: { taskId } })),
  history: (taskId: string) => unwrap(taskById.history.$get({ param: { taskId } })),
  create: (projectId: string, json: CreateTaskInput) =>
    unwrap(projectTasks.$post({ param: { projectId }, json })),
  update: (taskId: string, json: TaskPatch) => unwrap(taskById.$patch({ param: { taskId }, json })),
  remove: (taskId: string) => unwrap(taskById.$delete({ param: { taskId } })),
  search: (workspaceId: string, q: string) =>
    unwrap(
      client.api.workspaces[":workspaceId"].tasks.search.$get({
        param: { workspaceId },
        query: { q },
      }),
    ),
  addRelation: (taskId: string, type: RelationType, otherId: string) =>
    unwrap(taskById.relationships.$post({ param: { taskId }, json: { type, taskId: otherId } })),
  removeRelation: (taskId: string, type: RelationType, otherTaskId: string) =>
    unwrap(
      taskById.relationships[":otherTaskId"].$delete({
        param: { taskId, otherTaskId },
        query: { type },
      }),
    ),
}

export const taskKeys = {
  list: (projectId: string) => ["projects", projectId, "tasks"] as const,
  detail: (taskId: string) => ["tasks", taskId] as const,
  history: (taskId: string) => ["tasks", taskId, "history"] as const,
}

export const projectTasksQuery = (projectId: string) =>
  queryOptions({
    queryKey: taskKeys.list(projectId),
    queryFn: async () => (await taskApi.list(projectId)).tasks,
  })

export const taskQuery = (taskId: string) =>
  queryOptions({
    queryKey: taskKeys.detail(taskId),
    queryFn: async () => (await taskApi.get(taskId)).task,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })

export const taskSearchQuery = (workspaceId: string, q: string) =>
  queryOptions({
    queryKey: ["task-search", workspaceId, q] as const,
    queryFn: async () => (await taskApi.search(workspaceId, q)).tasks,
    staleTime: 5_000,
  })

export const taskHistoryQuery = (taskId: string) =>
  queryOptions({
    queryKey: taskKeys.history(taskId),
    queryFn: async () => (await taskApi.history(taskId)).history,
  })

/** Mutations carrying this meta have their failures shown by MutationErrorNotice. */
const notifyMeta = (message: string) => ({ errorNotice: message })

export const UPDATE_KEY = ["task-update"] as const

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: UPDATE_KEY,
    meta: notifyMeta("Could not save the task."),
    mutationFn: ({
      taskId,
      patch,
    }: {
      taskId: string
      projectId: string
      patch: TaskPatch
      view?: TaskPatchView
    }) => taskApi.update(taskId, patch).then((r) => r.task),
    onMutate: async ({ taskId, projectId, patch: fullPatch, view }) => {
      const { assigneeIds: _a, tagIds: _t, customFields: _c, ...plain } = fullPatch
      const optimistic: Record<string, unknown> = { ...plain, ...view }
      const fields = Object.keys(optimistic)
      await Promise.all([
        qc.cancelQueries({ queryKey: taskKeys.list(projectId) }),
        qc.cancelQueries({ queryKey: taskKeys.detail(taskId), exact: true }),
      ])
      // Only the fields this mutation touches are remembered, so a rollback can't undo other edits.
      const previous = (task: object | undefined) =>
        task ? pickFields(task as Record<string, unknown>, fields) : undefined
      const ctx = {
        list: previous(
          qc.getQueryData<TaskSummary[]>(taskKeys.list(projectId))?.find((t) => t.id === taskId),
        ),
        detail: previous(qc.getQueryData<TaskDetail>(taskKeys.detail(taskId))),
      }
      qc.setQueryData<TaskSummary[]>(taskKeys.list(projectId), (old) =>
        old?.map((t) => (t.id === taskId ? { ...t, ...optimistic } : t)),
      )
      qc.setQueryData<TaskDetail>(taskKeys.detail(taskId), (old) =>
        old ? { ...old, ...optimistic } : old,
      )
      return ctx
    },
    onError: (_error, { taskId, projectId }, ctx) => {
      if (!ctx) return
      const { list, detail } = ctx
      if (list) {
        qc.setQueryData<TaskSummary[]>(taskKeys.list(projectId), (old) =>
          old?.map((t) => (t.id === taskId ? { ...t, ...list } : t)),
        )
      }
      if (detail) {
        qc.setQueryData<TaskDetail>(taskKeys.detail(taskId), (old) =>
          old ? { ...old, ...detail } : old,
        )
      }
    },
    onSettled: (_data, _error, { taskId, projectId, patch }) => {
      // Refetching while another edit is in flight would overwrite its optimistic state.
      if (qc.isMutating({ mutationKey: UPDATE_KEY }) > 1) return
      void qc.invalidateQueries({ queryKey: taskKeys.list(projectId) })
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId), exact: true })
      if (patch.status) {
        void qc.invalidateQueries({ queryKey: taskKeys.history(taskId) })
        // A subtask's status feeds its parent's progress, which lives in the parent's detail.
        void qc.invalidateQueries({
          queryKey: ["tasks"],
          predicate: (q) => q.queryKey.length === 2,
        })
      }
    },
  })
}

function pickFields(task: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.map((f) => [f, task[f]]))
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) => taskApi.create(projectId, input).then((r) => r.task),
    onSettled: () => qc.invalidateQueries({ queryKey: taskKeys.list(projectId) }),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    meta: notifyMeta("Could not delete the task."),
    mutationFn: ({ taskId }: { taskId: string; projectId: string }) => taskApi.remove(taskId),
    onMutate: async ({ taskId, projectId }) => {
      await qc.cancelQueries({ queryKey: taskKeys.list(projectId) })
      const list = qc.getQueryData<TaskSummary[]>(taskKeys.list(projectId))
      qc.setQueryData<TaskSummary[]>(taskKeys.list(projectId), (old) =>
        old?.filter((t) => t.id !== taskId),
      )
      return { list }
    },
    onError: (_error, { projectId }, ctx) => {
      if (ctx?.list) qc.setQueryData(taskKeys.list(projectId), ctx.list)
    },
    onSuccess: (_d, { taskId }) => {
      qc.removeQueries({ queryKey: taskKeys.detail(taskId) })
    },
    onSettled: (_d, _e, { projectId }) =>
      qc.invalidateQueries({ queryKey: taskKeys.list(projectId) }),
  })
}

export function useCreateSubtask(parent: { id: string; projectId: string }) {
  const qc = useQueryClient()
  return useMutation({
    meta: notifyMeta("Could not add the subtask."),
    mutationFn: (title: string) =>
      taskApi.create(parent.projectId, { title, parentTaskId: parent.id }).then((r) => r.task),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.detail(parent.id), exact: true })
      void qc.invalidateQueries({ queryKey: taskKeys.list(parent.projectId) })
    },
  })
}

/** Adds or removes a relationship; both tasks' details are refreshed since each shows the link. */
export function useChangeRelationship(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    meta: notifyMeta("Could not change the relationship."),
    mutationFn: ({
      action,
      type,
      otherId,
    }: {
      action: "add" | "remove"
      type: RelationType
      otherId: string
    }) =>
      action === "add"
        ? taskApi.addRelation(taskId, type, otherId)
        : taskApi.removeRelation(taskId, type, otherId),
    onSuccess: (data) => qc.setQueryData(taskKeys.detail(taskId), data.task),
    onSettled: (_d, _e, { otherId }) =>
      qc.invalidateQueries({ queryKey: taskKeys.detail(otherId), exact: true }),
  })
}

export function invalidateProjectTasks(qc: QueryClient, projectId: string) {
  return qc.invalidateQueries({ queryKey: taskKeys.list(projectId) })
}

// Due dates are calendar days (YYYY-MM-DD) with no time zone, so compare them as local days.
function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

export type DueState = "neutral" | "soon" | "overdue"

export function dueState(dueAt: string, status: TaskStatus, now = new Date()): DueState {
  if (status === "complete") return "neutral"
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((parseDay(dueAt).getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return "overdue"
  return days <= 2 ? "soon" : "neutral"
}

export function formatDay(day: string, now = new Date()): string {
  const date = parseDay(day)
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  })
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
]

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(0, "second")
}

const myTasksApi = client.api.workspaces[":workspaceId"]["my-tasks"]
export type MyTask = InferResponseType<(typeof myTasksApi)["$get"]>["tasks"][number]

export const myTasksKey = (workspaceId: string) => ["my-tasks", workspaceId] as const

// Always refetch on mount: edits made on a project page do not touch this cache.
export const myTasksQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: myTasksKey(workspaceId),
    queryFn: async () => (await unwrap(myTasksApi.$get({ param: { workspaceId } }))).tasks,
    staleTime: 0,
  })
