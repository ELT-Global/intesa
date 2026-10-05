import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { useSyncExternalStore } from "react"
import { ApiError, client, unwrap } from "./api"

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "review", "complete"] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

const taskById = client.api.tasks[":taskId"]
const projectTasks = client.api.projects[":projectId"].tasks

export type TaskSummary = InferResponseType<typeof projectTasks.$get>["tasks"][number]
export type TaskDetail = InferResponseType<(typeof taskById)["$get"]>["task"]
export type HistoryEntry = InferResponseType<(typeof taskById.history)["$get"]>["history"][number]
export type UserRef = TaskSummary["assignees"][number]
export type TagRef = TaskSummary["tags"][number]

export type CreateTaskInput = {
  title: string
  status?: TaskStatus
  priority?: TaskPriority
  dueAt?: string
  body?: string
}

export type TaskPatch = {
  title?: string
  body?: string | null
  status?: TaskStatus
  priority?: TaskPriority | null
  dueAt?: string | null
}

const taskApi = {
  list: (projectId: string) => unwrap(projectTasks.$get({ param: { projectId } })),
  get: (taskId: string) => unwrap(taskById.$get({ param: { taskId } })),
  history: (taskId: string) => unwrap(taskById.history.$get({ param: { taskId } })),
  create: (projectId: string, json: CreateTaskInput) =>
    unwrap(projectTasks.$post({ param: { projectId }, json })),
  update: (taskId: string, json: TaskPatch) => unwrap(taskById.$patch({ param: { taskId }, json })),
  remove: (taskId: string) => unwrap(taskById.$delete({ param: { taskId } })),
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

export const taskHistoryQuery = (taskId: string) =>
  queryOptions({
    queryKey: taskKeys.history(taskId),
    queryFn: async () => (await taskApi.history(taskId)).history,
  })

// Mutation failures are shown by one notice component, so the hooks report through this store.
let currentError: { id: number; message: string } | null = null
const listeners = new Set<() => void>()
let errorSeq = 0

function notify() {
  for (const l of listeners) l()
}

function reportTaskError(error: unknown, fallback: string) {
  const message = error instanceof Error && error.message ? error.message : fallback
  currentError = { id: ++errorSeq, message }
  notify()
}

export function dismissTaskError() {
  currentError = null
  notify()
}

export function useTaskError() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => currentError,
    () => null,
  )
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; projectId: string; patch: TaskPatch }) =>
      taskApi.update(taskId, patch).then((r) => r.task),
    onMutate: async ({ taskId, projectId, patch }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: taskKeys.list(projectId) }),
        qc.cancelQueries({ queryKey: taskKeys.detail(taskId), exact: true }),
      ])
      const list = qc.getQueryData<TaskSummary[]>(taskKeys.list(projectId))
      const detail = qc.getQueryData<TaskDetail>(taskKeys.detail(taskId))
      qc.setQueryData<TaskSummary[]>(taskKeys.list(projectId), (old) =>
        old?.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      )
      qc.setQueryData<TaskDetail>(taskKeys.detail(taskId), (old) =>
        old ? { ...old, ...patch } : old,
      )
      return { list, detail }
    },
    onError: (error, { taskId, projectId }, ctx) => {
      if (ctx?.list) qc.setQueryData(taskKeys.list(projectId), ctx.list)
      if (ctx?.detail) qc.setQueryData(taskKeys.detail(taskId), ctx.detail)
      reportTaskError(error, "Could not save the task.")
    },
    onSettled: (_data, _error, { taskId, projectId, patch }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(projectId) })
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId), exact: true })
      if (patch.status) void qc.invalidateQueries({ queryKey: taskKeys.history(taskId) })
    },
  })
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) => taskApi.create(projectId, input).then((r) => r.task),
    onSuccess: (task) => {
      qc.setQueryData<TaskSummary[]>(taskKeys.list(projectId), (old) =>
        old ? [task, ...old.filter((t) => t.id !== task.id)] : old,
      )
    },
    onSettled: () => qc.invalidateQueries({ queryKey: taskKeys.list(projectId) }),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId }: { taskId: string; projectId: string }) => taskApi.remove(taskId),
    onMutate: async ({ taskId, projectId }) => {
      await qc.cancelQueries({ queryKey: taskKeys.list(projectId) })
      const list = qc.getQueryData<TaskSummary[]>(taskKeys.list(projectId))
      qc.setQueryData<TaskSummary[]>(taskKeys.list(projectId), (old) =>
        old?.filter((t) => t.id !== taskId),
      )
      return { list }
    },
    onError: (error, { projectId }, ctx) => {
      if (ctx?.list) qc.setQueryData(taskKeys.list(projectId), ctx.list)
      reportTaskError(error, "Could not delete the task.")
    },
    onSuccess: (_d, { taskId }) => {
      qc.removeQueries({ queryKey: taskKeys.detail(taskId) })
    },
    onSettled: (_d, _e, { projectId }) =>
      qc.invalidateQueries({ queryKey: taskKeys.list(projectId) }),
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
