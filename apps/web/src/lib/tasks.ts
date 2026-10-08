import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import type { InferRequestType, InferResponseType } from "hono/client"
import { useCallback } from "react"
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
/** Longest description the API accepts (apps/api/src/tasks/schemas.ts). */
export const TASK_BODY_MAX_LENGTH = 20000

export type CreateTaskInput = InferRequestType<typeof projectTasks.$post>["json"]
export type TaskPatch = InferRequestType<(typeof taskById)["$patch"]>["json"]
/** Where a card goes in its column: next to another card, or at either end. */
export type Placement = NonNullable<TaskPatch["placement"]>

/**
 * `list` with `taskId` placed as the server will place it. The list is in board order, so a
 * column reads top to bottom in list order. Unchanged when the column has nothing to place the
 * task next to (an empty column: any spot in it is the same).
 */
export function placeTask(list: TaskSummary[], taskId: string, placement: Placement) {
  const task = list.find((t) => t.id === taskId)
  if (!task) return list
  const others = list.filter((t) => t.id !== taskId)
  const inColumn = (t: TaskSummary) => t.status === task.status && !t.parentTaskId

  let at = -1
  if (placement === "first") at = others.findIndex(inColumn)
  else if (placement === "last") {
    const last = others.findLastIndex(inColumn)
    at = last < 0 ? -1 : last + 1
  } else {
    const anchor = "before" in placement ? placement.before : placement.after
    const found = others.findIndex((t) => t.id === anchor && inColumn(t))
    at = found < 0 ? -1 : found + ("after" in placement ? 1 : 0)
  }
  return at < 0 ? list : [...others.slice(0, at), task, ...others.slice(at)]
}

/** The list with `taskId` moved back to `index`. */
const moveToIndex = (list: TaskSummary[], taskId: string, index: number) => {
  const task = list.find((t) => t.id === taskId)
  if (!task) return list
  const others = list.filter((t) => t.id !== taskId)
  return [...others.slice(0, index), task, ...others.slice(index)]
}

/** Resolved people/tags matching a patch's id sets, so the cache can update before the server answers. */
export type TaskPatchView = { assignees?: UserRef[]; tags?: TagRef[] }

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
    placeholderData: keepPreviousData,
  })

export const taskHistoryQuery = (taskId: string) =>
  queryOptions({
    queryKey: taskKeys.history(taskId),
    queryFn: async () => (await taskApi.history(taskId)).history,
  })

/** Refreshes every cached view of tasks: lists, details, history, my tasks and home. */
export function invalidateTaskGraph(qc: QueryClient, projectId?: string) {
  void qc.invalidateQueries(
    projectId
      ? { queryKey: taskKeys.list(projectId) }
      : { queryKey: ["projects"], predicate: (q) => q.queryKey[2] === "tasks" },
  )
  // Details and history are inactive unless open, so this mostly just marks them stale.
  void qc.invalidateQueries({ queryKey: ["tasks"] })
  void qc.invalidateQueries({ queryKey: ["my-tasks"] })
  void qc.invalidateQueries({
    queryKey: ["workspaces"],
    predicate: (q) => q.queryKey[2] === "home",
  })
}

/** Mutations carrying this meta have their failures shown by MutationErrorNotice. */
const notifyMeta = (message: string) => ({ errorNotice: message })

// Shared by every task mutation: refetching while any of them is in flight would overwrite its
// optimistic state, so only the last one to settle refreshes.
const TASK_MUTATION = ["task-mutation"] as const

// Runs inside each mutation's onSettled, while that mutation still counts as pending. So a
// count of 1 means it is the last one in flight (queued same-task mutations count too), and
// only then is it safe to refetch without overwriting another mutation's optimistic state.
function settleTaskMutation(qc: QueryClient, projectId?: string) {
  if (qc.isMutating({ mutationKey: TASK_MUTATION }) === 1) invalidateTaskGraph(qc, projectId)
}

// Edits to one task run one after another, so responses cannot land out of order. The scope
// depends on the variables, which a hook cannot express, so these mutations are built and
// executed directly on the cache. With no observer attached they are garbage collected after
// gcTime once settled (an observer would hold on to them until it was unsubscribed).
const taskScope = (taskId: string) => ({ id: `task:${taskId}` })

type UpdateVars = {
  taskId: string
  projectId: string
  patch: TaskPatch
  /** Resolved people/tags for the patch; a function receives the task as currently cached. */
  view?: TaskPatchView | ((current: TaskSummary) => TaskPatchView)
  /** For subtask edits: the parent's detail shows this task, so it is updated too. */
  parentTaskId?: string | null
}

const SUMMARY_SCALARS = ["title", "status", "priority", "dueAt"] as const

type Rollback = {
  summary?: Record<string, unknown>
  detail?: Record<string, unknown>
  customFields?: Record<string, { had: boolean; value: unknown }>
  /** Previous values of the changed fields, in the parent's copy of this subtask. */
  parent?: Record<string, unknown>
  /** Where the task sat in the project's list, when the edit moved it. */
  index?: number
}

function pick(row: object | undefined, keys: string[]) {
  if (!row) return undefined
  const source = row as Record<string, unknown>
  return Object.fromEntries(keys.map((k) => [k, source[k]]))
}

function updateOptions(qc: QueryClient, vars: UpdateVars, onFailed?: () => void) {
  const { taskId, projectId, patch, parentTaskId } = vars
  return {
    mutationKey: TASK_MUTATION,
    scope: taskScope(taskId),
    meta: notifyMeta("Could not save the task."),
    mutationFn: (v: UpdateVars) => taskApi.update(v.taskId, v.patch).then((r) => r.task),
    onMutate: async (): Promise<Rollback> => {
      await Promise.all([
        qc.cancelQueries({ queryKey: taskKeys.list(projectId) }),
        qc.cancelQueries({ queryKey: taskKeys.detail(taskId), exact: true }),
      ])
      const listBefore = qc.getQueryData<TaskSummary[]>(taskKeys.list(projectId))
      const row = listBefore?.find((t) => t.id === taskId)
      const detail = qc.getQueryData<TaskDetail>(taskKeys.detail(taskId))
      const current = detail ?? row
      const resolved =
        typeof vars.view === "function" ? (current ? vars.view(current) : {}) : (vars.view ?? {})

      // List rows only ever hold summary fields; the detail also gets body and custom fields.
      const summaryChanges: Record<string, unknown> = {}
      for (const k of SUMMARY_SCALARS) if (patch[k] !== undefined) summaryChanges[k] = patch[k]
      if (resolved.assignees) summaryChanges.assignees = resolved.assignees
      if (resolved.tags) summaryChanges.tags = resolved.tags
      const detailChanges: Record<string, unknown> = { ...summaryChanges }
      if (patch.body !== undefined) detailChanges.body = patch.body

      const previousFields = detail
        ? Object.fromEntries(
            Object.keys(patch.customFields ?? {}).map((id) => {
              const values = detail.customFields as Record<string, unknown>
              return [id, { had: id in values, value: values[id] }]
            }),
          )
        : undefined

      // The server puts a task whose status changes at the top of its new column unless told
      // where; a card moved within its column stays put without a placement.
      const placement =
        patch.placement ??
        (row && patch.status !== undefined && patch.status !== row.status ? "first" : undefined)
      qc.setQueryData<TaskSummary[]>(taskKeys.list(projectId), (old) => {
        const edited = old?.map((t) => (t.id === taskId ? { ...t, ...summaryChanges } : t))
        return edited && placement ? placeTask(edited, taskId, placement) : edited
      })
      qc.setQueryData<TaskDetail>(taskKeys.detail(taskId), (old) => {
        if (!old) return old
        const customFields = { ...(old.customFields as Record<string, unknown>) }
        for (const [id, value] of Object.entries(patch.customFields ?? {})) {
          if (value === null) delete customFields[id]
          else customFields[id] = value
        }
        return { ...old, ...detailChanges, customFields } as TaskDetail
      })
      return {
        summary: pick(row, Object.keys(summaryChanges)),
        detail: pick(detail, Object.keys(detailChanges)),
        customFields: previousFields,
        parent: parentTaskId ? editSubtask(qc, parentTaskId, taskId, summaryChanges) : undefined,
        index: placement ? listBefore?.findIndex((t) => t.id === taskId) : undefined,
      }
    },
    onError: (_error: Error, _vars: UpdateVars, rollback: Rollback | undefined) => {
      onFailed?.()
      if (!rollback) return
      const { summary, detail, customFields, index } = rollback
      if (summary) {
        qc.setQueryData<TaskSummary[]>(taskKeys.list(projectId), (old) =>
          old?.map((t) => (t.id === taskId ? { ...t, ...summary } : t)),
        )
      }
      if (index !== undefined && index >= 0) {
        qc.setQueryData<TaskSummary[]>(
          taskKeys.list(projectId),
          (old) => old && moveToIndex(old, taskId, index),
        )
      }
      qc.setQueryData<TaskDetail>(taskKeys.detail(taskId), (old) => {
        if (!old) return old
        const restored = { ...(old.customFields as Record<string, unknown>) }
        for (const [id, prev] of Object.entries(customFields ?? {})) {
          if (prev.had) restored[id] = prev.value
          else delete restored[id]
        }
        return { ...old, ...detail, customFields: restored } as TaskDetail
      })
      if (parentTaskId && rollback.parent) editSubtask(qc, parentTaskId, taskId, rollback.parent)
    },
    onSettled: () => settleTaskMutation(qc, projectId),
  }
}

/** Optimistic task edits, serialised per task. */
export function useUpdateTask() {
  const qc = useQueryClient()
  const mutateAsync = useCallback(
    (vars: UpdateVars, callbacks?: { onError?: () => void }) =>
      qc
        .getMutationCache()
        .build(qc, updateOptions(qc, vars, callbacks?.onError))
        .execute(vars),
    [qc],
  )
  const mutate = useCallback(
    (vars: UpdateVars, callbacks?: { onError?: () => void }) => {
      mutateAsync(vars, callbacks).catch(() => {})
    },
    [mutateAsync],
  )
  return { mutate, mutateAsync }
}

/**
 * Applies changes to a subtask as listed in its parent's cached detail, keeping the parent's
 * counts right. Returns the previous values of the changed fields, to undo the edit.
 */
function editSubtask(
  qc: QueryClient,
  parentId: string,
  subtaskId: string,
  changes: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const parent = qc.getQueryData<TaskDetail>(taskKeys.detail(parentId))
  const entry = parent?.subtasks.find((t) => t.id === subtaskId)
  if (!parent || !entry) return undefined
  const subtasks = parent.subtasks.map((t) => (t.id === subtaskId ? { ...t, ...changes } : t))
  qc.setQueryData<TaskDetail>(taskKeys.detail(parentId), {
    ...parent,
    subtasks,
    subtaskDoneCount: subtasks.filter((t) => t.status === "complete").length,
  })
  return pick(entry, Object.keys(changes))
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: TASK_MUTATION,
    mutationFn: (input: CreateTaskInput) => taskApi.create(projectId, input).then((r) => r.task),
    onSettled: () => settleTaskMutation(qc, projectId),
  })
}

type DeleteVars = {
  taskId: string
  projectId: string
  /** For a subtask: removed from the parent's detail straight away too. */
  parentTaskId?: string | null
}

export function useDeleteTask() {
  const qc = useQueryClient()
  const mutate = useCallback(
    (vars: DeleteVars) => {
      const { taskId, projectId, parentTaskId } = vars
      qc.getMutationCache()
        .build(qc, {
          mutationKey: TASK_MUTATION,
          scope: taskScope(taskId),
          meta: notifyMeta("Could not delete the task."),
          mutationFn: (v: DeleteVars) => taskApi.remove(v.taskId),
          onMutate: async () => {
            await qc.cancelQueries({ queryKey: taskKeys.list(projectId) })
            const list = qc.getQueryData<TaskSummary[]>(taskKeys.list(projectId))
            qc.setQueryData<TaskSummary[]>(taskKeys.list(projectId), (old) =>
              old?.filter((t) => t.id !== taskId),
            )
            const parent = parentTaskId
              ? qc.getQueryData<TaskDetail>(taskKeys.detail(parentTaskId))
              : undefined
            if (parentTaskId && parent) {
              const subtasks = parent.subtasks.filter((t) => t.id !== taskId)
              qc.setQueryData<TaskDetail>(taskKeys.detail(parentTaskId), {
                ...parent,
                subtasks,
                subtaskCount: subtasks.length,
                subtaskDoneCount: subtasks.filter((t) => t.status === "complete").length,
              })
            }
            return { list, parent }
          },
          onError: (_error, _vars, ctx) => {
            if (ctx?.list) qc.setQueryData(taskKeys.list(projectId), ctx.list)
            if (parentTaskId && ctx?.parent)
              qc.setQueryData(taskKeys.detail(parentTaskId), ctx.parent)
          },
          onSuccess: () => qc.removeQueries({ queryKey: taskKeys.detail(taskId) }),
          onSettled: () => settleTaskMutation(qc, projectId),
        })
        .execute(vars)
        .catch(() => {})
    },
    [qc],
  )
  return { mutate }
}

export function useCreateSubtask(parent: { id: string; projectId: string }) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: TASK_MUTATION,
    scope: taskScope(parent.id),
    meta: notifyMeta("Could not add the subtask."),
    mutationFn: (title: string) =>
      taskApi.create(parent.projectId, { title, parentTaskId: parent.id }).then((r) => r.task),
    onSettled: () => settleTaskMutation(qc, parent.projectId),
  })
}

/** Adds or removes a relationship. Both tasks show the link, so everything is refetched. */
export function useChangeRelationship(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: TASK_MUTATION,
    scope: taskScope(taskId),
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
    onSettled: () => settleTaskMutation(qc),
  })
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

/** The calendar day `offset` days from `now`, as YYYY-MM-DD. */
export function dayFromToday(offset: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
