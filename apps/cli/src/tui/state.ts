// The board's state, its overlays, and what is derived from it. Pure: the store changes it,
// the keymap and the view read it.
import {
  compareBy,
  type Placement,
  type Sort,
  type TaskStatus,
  UNASSIGNED,
} from "@intesa/task-query"
import type {
  Artifact,
  BoardApi,
  Field,
  History,
  Me,
  Member,
  Project,
  Task,
  TaskDetail,
  Workspace,
} from "./api"
import { handle } from "./api"
import { type Changes, filterTasks, fuzzyFilter } from "./model"

export type View = "board" | "table"

export type MenuItem = { label: string; key?: string; current?: boolean; run: () => void }
export type PickerItem = { label: string; run: () => void }

export type DetailOverlay = { kind: "detail"; taskId: string; item: number }
export type InputOverlay = {
  kind: "input"
  label: string
  value: string
  allowEmpty: boolean
  error?: string
  onChange?: (value: string) => void
  // Returns an error to keep the input open.
  onSubmit: (value: string) => string | undefined
  onCancel?: () => void
}
export type MenuOverlay = { kind: "menu"; title: string; items: MenuItem[]; index: number }
export type PickerOverlay = {
  kind: "picker"
  title: string
  items: PickerItem[]
  query: string
  index: number
}
export type ConfirmOverlay = { kind: "confirm"; message: string; onYes: () => void }
export type SyncOverlay = {
  kind: "sync"
  task: Task
  status: TaskStatus
  subtasks: Task[]
  // Only the subtasks given a new status.
  picked: Record<string, TaskStatus>
  index: number
}
// One question of the dialog that moving a task into Complete opens. `answer` is the chosen
// option's `value`: undefined while unanswered. Another question (who did it) is another entry
// in `questions`, with its own options.
export type CompleteQuestion = {
  field: "reviewedById" | "testedById"
  label: string
  options: { value: string | null; label: string }[]
  answer?: string | null
}
export type CompleteOverlay = {
  kind: "complete"
  task: Task
  placement?: Placement
  questions: CompleteQuestion[]
  index: number
}
export type Overlay =
  | DetailOverlay
  | InputOverlay
  | MenuOverlay
  | PickerOverlay
  | ConfirmOverlay
  | SyncOverlay
  | CompleteOverlay
  | { kind: "help" }

export type DetailEntry = {
  task?: TaskDetail
  artifacts: Artifact[]
  history: History[]
  error?: string
}

export type State = {
  workspace: Workspace
  project?: Project
  me?: Me
  members: Member[]
  fields: Field[]
  // Top-level tasks of the project, in board order.
  tasks: Task[]
  loaded: boolean
  error?: string
  view: View
  backlogOpen: boolean
  // The focused card; Backlog while it is folded means its rail.
  focus: { status: TaskStatus; index: number; taskId?: string }
  row: { index: number; taskId?: string }
  sort: Sort | null
  query: string
  // User ids (or UNASSIGNED); empty is everyone.
  assignees: string[]
  overlays: Overlay[]
  details: Record<string, DetailEntry>
  toast?: { text: string; error: boolean }
}

// What the store needs from the terminal.
export type Host = {
  copy: (text: string) => boolean
  // Hands the terminal to `run` (an editor) and takes it back afterwards.
  suspend: <T>(run: () => Promise<T>) => Promise<T>
  quit: () => void
}

// What the parts of the store share.
export type Core = {
  api: BoardApi
  host: Host
  get: () => State
  set: (next: Partial<State> | ((s: State) => Partial<State>)) => void
  track: <T>(p: Promise<T>) => Promise<T>
  push: (o: Overlay) => void
  toast: (text: string, error?: boolean) => void
  failed: (what: string, err: unknown) => void
}

export const shownTasks = (s: State) =>
  filterTasks(s.tasks, { assignees: s.assignees, query: s.query, meId: s.me?.id })

export const tableRows = (s: State, shown = shownTasks(s)) =>
  s.sort ? [...shown].sort(compareBy(s.sort)) : shown

export const railFocused = (s: State) => s.focus.status === "backlog" && !s.backlogOpen

// The card or row that keys act on, or the task open in the detail pane.
export function targetTask(s: State): Task | undefined {
  const top = s.overlays.findLast((o) => o.kind === "detail")
  if (top) return taskById(s, top.taskId)
  if (s.view === "table") return tableRows(s)[s.row.index]
  if (railFocused(s)) return undefined
  return shownTasks(s).filter((t) => t.status === s.focus.status)[s.focus.index]
}

// A task from the list, else from a loaded detail (subtasks are not on the board).
export function taskById(s: State, id: string): Task | undefined {
  const row = s.tasks.find((t) => t.id === id)
  if (row) return row
  for (const entry of Object.values(s.details)) {
    if (entry.task?.id === id) return entry.task
    const sub = entry.task?.subtasks.find((t) => t.id === id)
    if (sub) return sub
  }
  return undefined
}

export function filterLabel(s: State) {
  const [only] = s.assignees
  if (!only) return "everyone"
  if (s.assignees.length > 1) return `${s.assignees.length} people`
  if (only === UNASSIGNED) return "unassigned"
  if (only === s.me?.id) return "@me"
  const member = s.members.find((m) => m.userId === only)
  return member ? handle(member.name) : "1 person"
}

export const pickerItems = (o: PickerOverlay) => fuzzyFilter(o.items, o.query, (i) => i.label)

export const detailItems = (entry: DetailEntry | undefined) => [
  ...(entry?.task?.subtasks ?? []).map((task) => ({ kind: "subtask" as const, task })),
  ...(entry?.artifacts ?? []).map((artifact) => ({ kind: "artifact" as const, artifact })),
]

export const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max))

// Keeps the focus on the same card when the list changes, else at the same place.
export function normalize(s: State): State {
  const shown = shownTasks(s)
  const column = shown.filter((t) => t.status === s.focus.status)
  let index = s.focus.index
  const at = s.focus.taskId ? column.findIndex((t) => t.id === s.focus.taskId) : -1
  if (at >= 0) index = at
  index = clamp(index, column.length - 1)
  const rows = tableRows(s, shown)
  let rowIndex = s.row.index
  const rowAt = s.row.taskId ? rows.findIndex((t) => t.id === s.row.taskId) : -1
  if (rowAt >= 0) rowIndex = rowAt
  rowIndex = clamp(rowIndex, rows.length - 1)
  return {
    ...s,
    focus: { status: s.focus.status, index, taskId: column[index]?.id },
    row: { index: rowIndex, taskId: rows[rowIndex]?.id },
  }
}

// Details open or cached with an edit applied to the task, wherever it appears.
export function patchDetails(details: State["details"], taskId: string, changes: Changes) {
  const out: State["details"] = {}
  for (const [id, entry] of Object.entries(details)) {
    const task = entry.task
    if (!task) {
      out[id] = entry
      continue
    }
    out[id] = {
      ...entry,
      task: {
        ...task,
        ...(task.id === taskId ? changes : {}),
        subtasks: task.subtasks.map((s) => (s.id === taskId ? { ...s, ...changes } : s)),
      },
    }
  }
  return out
}

// A subtask shown before the server has made it: nothing can be done to it until then.
export const DRAFT = "draft:"
export const isDraft = (task: { id: string }) => task.id.startsWith(DRAFT)

const recount = <T extends Task>(task: T, sub: Task, by: 1 | -1): T => ({
  ...task,
  subtaskCount: task.subtaskCount + by,
  subtaskDoneCount: task.subtaskDoneCount + (sub.status === "complete" ? by : 0),
})

/**
 * The board and its details with `sub` added under its parent (at `index`, else last) or, by
 * -1, taken out, and the parent's subtask counts to match.
 */
export function withSubtask(
  s: State,
  sub: Task,
  by: 1 | -1,
  index?: number,
): Pick<State, "tasks" | "details"> {
  const parentId = sub.parentTaskId ?? ""
  const tasks = s.tasks.map((t) => (t.id === parentId ? recount(t, sub, by) : t))
  const entry = s.details[parentId]
  if (!entry?.task) return { tasks, details: s.details }
  const others = entry.task.subtasks.filter((t) => t.id !== sub.id)
  if (by < 0 && others.length === entry.task.subtasks.length) return { tasks, details: s.details }
  const subtasks = by > 0 ? others.toSpliced(index ?? others.length, 0, sub) : others
  const task = { ...recount(entry.task, sub, by), subtasks }
  return { tasks, details: { ...s.details, [parentId]: { ...entry, task } } }
}

// The subtask selected in an open pane.
export function selectedTask(s: State, o: DetailOverlay): Task | undefined {
  const item = detailItems(s.details[o.taskId])[o.item]
  return item?.kind === "subtask" ? item.task : undefined
}
