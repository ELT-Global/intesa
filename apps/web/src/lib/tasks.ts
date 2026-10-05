import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferRequestType, InferResponseType } from "hono/client"
import { ApiError, client, keys, unwrap } from "./api"

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

type TaskGraphScope = {
  projectId?: string
  taskId?: string
  /** Defaults to the parent in the cached detail. */
  parentTaskId?: string | null
  /** Defaults to the relationships in the cached detail. */
  relatedTaskIds?: string[]
  /** Without it, every workspace's my-tasks and home data is refreshed. */
  workspaceId?: string
}

/** Refreshes everything that can show a change to one task: lists, details, history and dashboards. */
export function invalidateTaskGraph(qc: QueryClient, scope: TaskGraphScope) {
  const { projectId, taskId, workspaceId } = scope
  const cached = taskId ? qc.getQueryData<TaskDetail>(taskKeys.detail(taskId)) : undefined
  const parentId = scope.parentTaskId === undefined ? cached?.parent?.id : scope.parentTaskId
  const relatedIds =
    scope.relatedTaskIds ??
    (cached ? [...cached.blocks, ...cached.blockedBy, ...cached.related].map((r) => r.id) : [])

  if (projectId) void qc.invalidateQueries({ queryKey: taskKeys.list(projectId) })
  if (taskId) {
    void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId), exact: true })
    void qc.invalidateQueries({ queryKey: taskKeys.history(taskId) })
  }
  if (parentId) void qc.invalidateQueries({ queryKey: taskKeys.detail(parentId), exact: true })
  for (const id of relatedIds) {
    void qc.invalidateQueries({ queryKey: taskKeys.detail(id), exact: true })
  }
  void qc.invalidateQueries({ queryKey: workspaceId ? myTasksKey(workspaceId) : ["my-tasks"] })
  void qc.invalidateQueries({
    queryKey: workspaceId ? keys.home(workspaceId) : ["workspaces"],
    predicate: (q) => q.queryKey[2] === "home",
  })
}

/** Refreshes every cached task view, e.g. after a member's assignments are removed. */
export function invalidateWorkspaceTasks(qc: QueryClient, workspaceId: string) {
  void qc.invalidateQueries({
    queryKey: ["projects"],
    predicate: (q) => q.queryKey[2] === "tasks" && q.queryKey.length === 3,
  })
  void qc.invalidateQueries({ queryKey: ["tasks"] })
  void qc.invalidateQueries({ queryKey: myTasksKey(workspaceId) })
  void qc.invalidateQueries({ queryKey: keys.home(workspaceId) })
}

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
      /** For subtask edits: the parent's detail shows this task, so it is updated and refreshed too. */
      parentTaskId?: string | null
    }) => taskApi.update(taskId, patch).then((r) => r.task),
    onMutate: async ({ taskId, projectId, patch: fullPatch, view, parentTaskId }) => {
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
      const parentStatus = parentTaskId
        ? setSubtaskStatus(qc, parentTaskId, taskId, fullPatch.status)
        : undefined
      return { ...ctx, parentStatus }
    },
    onError: (_error, { taskId, projectId, parentTaskId }, ctx) => {
      if (!ctx) return
      const { list, detail } = ctx
      if (parentTaskId && ctx.parentStatus)
        setSubtaskStatus(qc, parentTaskId, taskId, ctx.parentStatus)
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
    onSettled: (_data, _error, { taskId, projectId, parentTaskId }) => {
      // Refetching while another edit is in flight would overwrite its optimistic state.
      const pending = qc
        .getMutationCache()
        .findAll({ mutationKey: UPDATE_KEY, status: "pending" })
        .map((m) => m.state.variables as { taskId: string; projectId: string })
      if (pending.filter((v) => v.taskId === taskId).length > 1) return
      const projectBusy = pending.filter((v) => v.projectId === projectId).length > 1
      invalidateTaskGraph(qc, {
        taskId,
        parentTaskId,
        projectId: projectBusy ? undefined : projectId,
      })
    },
  })
}

/** Sets a subtask's status inside its parent's cached detail; returns the previous status. */
function setSubtaskStatus(
  qc: QueryClient,
  parentId: string,
  subtaskId: string,
  status: TaskStatus | undefined,
): TaskStatus | undefined {
  const parent = qc.getQueryData<TaskDetail>(taskKeys.detail(parentId))
  const previous = parent?.subtasks.find((t) => t.id === subtaskId)?.status
  if (!parent || !status || !previous) return undefined
  const subtasks = parent.subtasks.map((t) => (t.id === subtaskId ? { ...t, status } : t))
  qc.setQueryData<TaskDetail>(taskKeys.detail(parentId), {
    ...parent,
    subtasks,
    subtaskDoneCount: subtasks.filter((t) => t.status === "complete").length,
  })
  return previous
}

function pickFields(task: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.map((f) => [f, task[f]]))
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) => taskApi.create(projectId, input).then((r) => r.task),
    onSettled: (_d, _e, input) =>
      invalidateTaskGraph(qc, { projectId, parentTaskId: input.parentTaskId ?? null }),
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
      const cached = qc.getQueryData<TaskDetail>(taskKeys.detail(taskId))
      return {
        list,
        parentTaskId: cached?.parent?.id ?? null,
        relatedTaskIds: cached
          ? [...cached.blocks, ...cached.blockedBy, ...cached.related].map((r) => r.id)
          : [],
      }
    },
    onError: (_error, { projectId }, ctx) => {
      if (ctx?.list) qc.setQueryData(taskKeys.list(projectId), ctx.list)
    },
    onSuccess: (_d, { taskId }) => {
      qc.removeQueries({ queryKey: taskKeys.detail(taskId) })
    },
    onSettled: (_d, _e, { projectId }, ctx) =>
      invalidateTaskGraph(qc, {
        projectId,
        parentTaskId: ctx?.parentTaskId,
        relatedTaskIds: ctx?.relatedTaskIds,
      }),
  })
}

export function useCreateSubtask(parent: { id: string; projectId: string }) {
  const qc = useQueryClient()
  return useMutation({
    meta: notifyMeta("Could not add the subtask."),
    mutationFn: (title: string) =>
      taskApi.create(parent.projectId, { title, parentTaskId: parent.id }).then((r) => r.task),
    onSettled: () => invalidateTaskGraph(qc, { projectId: parent.projectId, taskId: parent.id }),
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
      invalidateTaskGraph(qc, { taskId, relatedTaskIds: [otherId] }),
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
