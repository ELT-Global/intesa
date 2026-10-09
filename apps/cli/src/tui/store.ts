// The board's state and every action on it. Rendering subscribes to changes; nothing here
// knows about the terminal except through `Host`, so it runs the same under the test renderer.
import { isRealDate } from "@intesa/api/schemas"
import {
  dayFromToday,
  type Placement,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@intesa/task-query"
import {
  type Artifact,
  type BoardApi,
  type Field,
  type History,
  type Me,
  type Member,
  type Project,
  reasonOf,
  type Start,
  type Task,
  type TaskDetail,
  type TaskPatch,
  type Workspace,
} from "./api"
import { fromDoc, toDoc } from "./edit-doc"
import {
  applyChanges,
  assigneeViews,
  type Changes,
  compareBy,
  filterTasks,
  fuzzyFilter,
  handle,
  isInPlace,
  newTaskAssignees,
  nextSort,
  nextStatus,
  revert,
  type Sort,
  type SortKey,
  stepAssigneeView,
  UNASSIGNED,
} from "./model"

export type View = "board" | "table"

export type MenuItem = { label: string; key?: string; current?: boolean; run: () => void }
export type PickerItem = { label: string; run: () => void }

export type DetailOverlay = { kind: "detail"; taskId: string; scroll: number; item: number }
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
export type Overlay =
  | DetailOverlay
  | InputOverlay
  | MenuOverlay
  | PickerOverlay
  | ConfirmOverlay
  | SyncOverlay
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

// --- Selectors -------------------------------------------------------------------------

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

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max))

// Keeps the focus on the same card when the list changes, else at the same place.
function normalize(s: State): State {
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

function patchDetails(details: State["details"], taskId: string, changes: Changes) {
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const MARKDOWN = "text/markdown"
const BLOCKING = new Set(["input", "menu", "picker", "confirm", "sync"])

// --- Store -----------------------------------------------------------------------------

export function createStore(
  api: BoardApi,
  start: Start,
  host: Host,
  opts: { pollMs?: number } = {},
) {
  let state: State = {
    workspace: start.workspace,
    project: start.project,
    members: [],
    fields: [],
    tasks: [],
    loaded: false,
    view: "board",
    backlogOpen: false,
    focus: { status: "todo", index: 0 },
    row: { index: 0 },
    sort: null,
    query: "",
    assignees: [],
    overlays: [],
    details: {},
  }
  const listeners = new Set<() => void>()

  function set(next: Partial<State> | ((s: State) => Partial<State>)) {
    state = normalize({ ...state, ...(typeof next === "function" ? next(state) : next) })
    for (const fn of listeners) fn()
  }

  // Requests the store is waiting on, so tests (and polling) can tell when it is idle.
  const loads = new Set<Promise<unknown>>()
  function track<T>(p: Promise<T>): Promise<T> {
    loads.add(p)
    p.then(
      () => loads.delete(p),
      () => loads.delete(p),
    )
    return p
  }

  // Writes run one at a time, so responses cannot land out of order. Refetching while one
  // is in flight would overwrite its optimistic state, so only the last to settle refreshes.
  let busy = 0
  let chain: Promise<unknown> = Promise.resolve()
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    busy++
    const run = chain.then(work).finally(() => {
      busy--
      if (busy === 0) void refresh()
    })
    chain = run.catch(() => {})
    return run
  }

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function toast(text: string, error = false) {
    clearTimeout(toastTimer)
    set({ toast: { text, error } })
    toastTimer = setTimeout(() => set({ toast: undefined }), error ? 6000 : 3000)
    toastTimer.unref?.()
  }
  const failed = (what: string, err: unknown) => {
    const reason = reasonOf(err)
    toast(reason ? `${what}: ${reason}` : `${what}.`, true)
  }

  // --- Overlays ---
  const push = (o: Overlay) => set((s) => ({ overlays: [...s.overlays, o] }))
  const pop = () => set((s) => ({ overlays: s.overlays.slice(0, -1) }))
  // Replaces the top overlay with an edited copy of itself.
  function edit<O extends Overlay>(o: O, change: Partial<O>) {
    set((s) => ({ overlays: s.overlays.map((x) => (x === o ? { ...o, ...change } : x)) }))
  }
  const top = () => state.overlays.at(-1)

  // --- Loading ---
  async function refresh() {
    const project = state.project
    if (!project) return
    for (const o of state.overlays) if (o.kind === "detail") void loadDetail(o.taskId)
    try {
      const tasks = await track(api.tasks(project.id))
      if (busy > 0 || state.project?.id !== project.id) return
      set({ tasks, loaded: true, error: undefined })
    } catch (err) {
      if (state.loaded) failed("Could not refresh the board", err)
      else set({ error: reasonOf(err) ?? "Could not load the tasks." })
    }
  }

  async function openProject(project: Project) {
    set({
      project,
      tasks: [],
      fields: [],
      loaded: false,
      error: undefined,
      overlays: [],
      details: {},
      query: "",
      focus: { status: "todo", index: 0 },
      row: { index: 0 },
    })
    const fields = track(api.fields(project.id)).catch(() => [] as Field[])
    await refresh()
    set({ fields: await fields })
  }

  async function loadDetail(taskId: string) {
    try {
      const [task, artifacts, history] = await track(
        Promise.all([api.task(taskId), api.artifacts(taskId), api.history(taskId)]),
      )
      set((s) => ({ details: { ...s.details, [taskId]: { task, artifacts, history } } }))
    } catch (err) {
      const reason = reasonOf(err) ?? "Could not load the task."
      set((s) => {
        const prev = s.details[taskId] ?? { artifacts: [], history: [] }
        return { details: { ...s.details, [taskId]: { ...prev, error: reason } } }
      })
    }
  }

  async function init() {
    try {
      const [me, members] = await track(Promise.all([api.me(), api.members(state.workspace.id)]))
      // Like the web board, the filter starts on the current user.
      set({ me, members, assignees: [me.id] })
    } catch (err) {
      set({ error: reasonOf(err) ?? "Could not reach the server." })
      return
    }
    if (state.project) await openProject(state.project)
    else await pickProject()
    if (start.openTask) {
      const task = state.tasks.find((t) => t.id === start.openTask)
      if (task) set({ focus: { status: task.status, index: 0, taskId: task.id } })
      openDetail(start.openTask)
    }
  }

  // --- Writes ---

  /** Applies `patch` at once, sends it, and puts things back if the server says no. */
  function update(task: Task, patch: TaskPatch, view: Changes = {}): Promise<boolean> {
    const changes: Changes = { ...view }
    for (const k of ["title", "body", "status", "priority", "dueAt"] as const) {
      if (patch[k] !== undefined) Object.assign(changes, { [k]: patch[k] })
    }
    const { list, undo } = applyChanges(state.tasks, task.id, changes, patch.placement)
    set((s) => ({ tasks: list, details: patchDetails(s.details, task.id, changes) }))
    return enqueue(async () => {
      try {
        await api.update(task.id, patch)
        return true
      } catch (err) {
        if (undo) set((s) => ({ tasks: revert(s.tasks, task.id, undo) }))
        failed(`Could not save ${task.key}`, err)
        return false
      }
    })
  }

  function moveTo(task: Task, status: TaskStatus, placement?: Placement) {
    if (task.status === status) {
      if (!placement || isInPlace(state.tasks, task, placement)) return
      void update(task, { placement })
      return
    }
    const followed = state.focus.taskId === task.id
    const done = update(task, { status, ...(placement && { placement }) })
    // The focus goes with the card, opening Backlog if that is where it went.
    if (followed) {
      set((s) => ({
        focus: { status, index: 0, taskId: task.id },
        backlogOpen: s.backlogOpen || status === "backlog",
      }))
    }
    if (task.subtaskCount > 0) {
      void done.then((ok) => {
        if (ok) void track(offerSync(task.id, status))
      })
    }
  }

  // After a column change, asks what should happen to subtasks in another status.
  async function offerSync(taskId: string, status: TaskStatus) {
    let detail: TaskDetail
    try {
      detail = await track(api.task(taskId))
    } catch {
      return
    }
    // Skipped if the card has been moved on again meanwhile.
    if (taskById(state, taskId)?.status !== status) return
    if (!detail.subtasks.some((s) => s.status !== status)) return
    push({ kind: "sync", task: detail, status, subtasks: detail.subtasks, picked: {}, index: 0 })
  }

  function moveBy(delta: -1 | 1) {
    const task = targetTask(state)
    if (!task) return
    const next = nextStatus(task.status, delta)
    if (!next) {
      toast(`${task.key} is already in ${STATUS_LABELS[task.status]}`)
      return
    }
    moveTo(task, next)
  }

  // Reorders among the visible cards: with a filter on, a card passes the hidden ones.
  function moveWithin(delta: -1 | 1) {
    if (state.view !== "board" || state.overlays.length > 0) return
    const task = targetTask(state)
    if (!task) return
    const column = shownTasks(state).filter((t) => t.status === task.status)
    const at = column.findIndex((t) => t.id === task.id)
    const next = column[at + delta]
    if (!next) {
      toast(
        `${task.key} is already the ${delta < 0 ? "first" : "last"} card in ${STATUS_LABELS[task.status]}`,
      )
      return
    }
    moveTo(task, task.status, delta < 0 ? { before: next.id } : { after: next.id })
  }

  function toggleMe(task: Task) {
    const me = state.me
    if (!me) return
    const mine = task.assignees.some((a) => a.id === me.id)
    const next = mine
      ? task.assignees.filter((a) => a.id !== me.id)
      : [...task.assignees, { id: me.id, name: me.name, avatarUrl: me.avatarUrl ?? null }]
    void update(task, { assigneeIds: next.map((a) => a.id) }, { assignees: next })
  }

  function createTask(title: string, status: TaskStatus) {
    const project = state.project
    if (!project) return
    const assigneeIds = newTaskAssignees(state.assignees, state.me?.id)
    void enqueue(async () => {
      try {
        const task = await api.create(project.id, { title, status, assigneeIds })
        set((s) => ({
          tasks: [task, ...s.tasks.filter((t) => t.id !== task.id)],
          focus: { status, index: 0, taskId: task.id },
          row: { index: 0, taskId: task.id },
          backlogOpen: s.backlogOpen || status === "backlog",
        }))
        toast(`Created ${task.key}`)
      } catch (err) {
        failed("Could not create the task", err)
      }
    })
  }

  function removeTask(task: Task) {
    const index = state.tasks.findIndex((t) => t.id === task.id)
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== task.id),
      overlays: s.overlays.filter((o) => !(o.kind === "detail" && o.taskId === task.id)),
    }))
    void enqueue(async () => {
      try {
        await api.remove(task.id)
        toast(`Deleted ${task.key}`)
      } catch (err) {
        if (index >= 0) {
          set((s) => ({ tasks: [...s.tasks.slice(0, index), task, ...s.tasks.slice(index)] }))
        }
        failed(`Could not delete ${task.key}`, err)
      }
    })
  }

  async function editTask(task: Task) {
    let saved: string
    try {
      saved = await host.suspend(() => api.edit(toDoc(task.title, task.body), `${task.key}.md`))
    } catch (err) {
      toast(`Could not edit ${task.key}: ${(err as Error).message}`, true)
      return
    }
    const { title, body } = fromDoc(saved)
    if (!title) {
      toast("A task needs a title; nothing was saved.", true)
      return
    }
    const patch: TaskPatch = {}
    if (title !== task.title) patch.title = title
    if (body !== (task.body ?? "").trimEnd()) patch.body = body
    if (Object.keys(patch).length === 0) {
      toast("No changes")
      return
    }
    await update(task, patch)
  }

  async function openArtifact(taskId: string, artifact: Artifact) {
    if (artifact.mimeType !== MARKDOWN) {
      const url = api.artifactUrl(taskId, artifact.id)
      toast(api.openUrl(url) ? `Opening ${artifact.name} in your browser` : `Open ${url}`)
      return
    }
    try {
      const text = await track(api.artifactText(taskId, artifact.id))
      const edited = await host.suspend(() => api.edit(text, artifact.name))
      if (edited === text) {
        toast("No changes")
        return
      }
      await enqueue(() => api.saveArtifact(taskId, artifact, edited))
      toast(`Saved ${artifact.name}`)
    } catch (err) {
      toast(`Could not edit ${artifact.name}: ${(err as Error).message}`, true)
    }
  }

  // --- Menus and prompts ---

  function menu(title: string, items: MenuItem[]) {
    push({
      kind: "menu",
      title,
      items,
      index: Math.max(
        0,
        items.findIndex((i) => i.current),
      ),
    })
  }

  const statusMenu = (task: Task) =>
    menu(
      `Status of ${task.key}`,
      TASK_STATUSES.map((status) => ({
        label: STATUS_LABELS[status],
        key: { backlog: "b", todo: "t", in_progress: "i", review: "r", complete: "c" }[status],
        current: task.status === status,
        run: () => moveTo(task, status),
      })),
    )

  const priorityMenu = (task: Task) =>
    menu(`Priority of ${task.key}`, [
      ...[...TASK_PRIORITIES].reverse().map((p: TaskPriority) => ({
        label: PRIORITY_LABELS[p],
        key: p[0],
        current: task.priority === p,
        run: () => void update(task, { priority: p }),
      })),
      {
        label: "No priority",
        key: "n",
        current: task.priority === null,
        run: () => void update(task, { priority: null }),
      },
    ])

  const dueMenu = (task: Task) =>
    menu(`Due date of ${task.key}`, [
      { label: "Today", key: "t", run: () => void update(task, { dueAt: dayFromToday(0) }) },
      { label: "Tomorrow", key: "m", run: () => void update(task, { dueAt: dayFromToday(1) }) },
      { label: "Next week", key: "w", run: () => void update(task, { dueAt: dayFromToday(7) }) },
      { label: "Pick a date…", key: "p", run: () => dueInput(task) },
      ...(task.dueAt
        ? [{ label: "Clear", key: "c", run: () => void update(task, { dueAt: null }) }]
        : []),
    ])

  function dueInput(task: Task) {
    push({
      kind: "input",
      label: `Due date of ${task.key} (YYYY-MM-DD)`,
      value: task.dueAt ?? "",
      allowEmpty: true,
      onSubmit: (value) => {
        const day = value.trim()
        if (day && !isRealDate(day)) return "Use a date like 2026-10-31"
        void update(task, { dueAt: day || null })
        return undefined
      },
    })
  }

  function confirmDelete(task: Task) {
    const subtasks = task.subtaskCount
      ? ` Its ${plural(task.subtaskCount, "subtask")} will be deleted too.`
      : ""
    push({
      kind: "confirm",
      message: `Delete ${task.key} (${task.title})?${subtasks}`,
      onYes: () => removeTask(task),
    })
  }

  function copy(text: string, what: string) {
    toast(host.copy(text) ? `Copied ${what}` : "Could not copy to the clipboard", false)
  }

  function openInBrowser(task: Task) {
    const url = api.taskUrl(state.workspace.slug, task)
    toast(api.openUrl(url) ? `Opening ${task.key} in your browser` : `Open ${url}`)
  }

  function taskMenu(task: Task) {
    const mine = !!state.me && task.assignees.some((a) => a.id === state.me?.id)
    menu(`${task.key}`, [
      { label: "Open", key: "enter", run: () => openDetail(task.id) },
      { label: "Status…", key: "s", run: () => statusMenu(task) },
      { label: "Priority…", key: "p", run: () => priorityMenu(task) },
      { label: mine ? "Unassign me" : "Assign to me", key: "a", run: () => toggleMe(task) },
      { label: "Due date…", key: "d", run: () => dueMenu(task) },
      { label: "Edit title and description", key: "e", run: () => void track(editTask(task)) },
      { label: "Copy key", key: "y", run: () => copy(task.key, task.key) },
      {
        label: "Copy link",
        key: "l",
        run: () => copy(api.taskUrl(state.workspace.slug, task), "link"),
      },
      { label: "Open in browser", key: "o", run: () => openInBrowser(task) },
      { label: "Delete…", key: "x", run: () => confirmDelete(task) },
    ])
  }

  function openDetail(taskId: string) {
    push({ kind: "detail", taskId, scroll: 0, item: -1 })
    void loadDetail(taskId)
  }

  async function pickProject() {
    let projects: Project[]
    try {
      projects = await track(api.projects(state.workspace.id))
    } catch (err) {
      failed("Could not list the projects", err)
      return
    }
    if (projects.length === 0) {
      set({ error: `No projects in ${state.workspace.slug} yet.` })
      return
    }
    push({
      kind: "picker",
      title: `Projects in ${state.workspace.slug}`,
      query: "",
      index: Math.max(
        0,
        projects.findIndex((p) => p.id === state.project?.id),
      ),
      items: projects.map((p) => ({ label: `${p.key}  ${p.name}`, run: () => openProject(p) })),
    })
  }

  async function switchWorkspace(workspace: Workspace) {
    set({ workspace, project: undefined, members: [], tasks: [], loaded: false, overlays: [] })
    try {
      const members = await track(api.members(workspace.id))
      set((s) => ({ members, assignees: s.me ? [s.me.id] : [] }))
    } catch (err) {
      failed("Could not load the members", err)
    }
    await pickProject()
  }

  async function pickWorkspace() {
    let workspaces: Workspace[]
    try {
      workspaces = await track(api.workspaces())
    } catch (err) {
      failed("Could not list the workspaces", err)
      return
    }
    push({
      kind: "picker",
      title: "Workspaces",
      query: "",
      index: Math.max(
        0,
        workspaces.findIndex((w) => w.id === state.workspace.id),
      ),
      items: workspaces.map((w) => ({
        label: w.slug,
        run: () => void switchWorkspace({ id: w.id, slug: w.slug }),
      })),
    })
  }

  // --- Polling ---
  const poll =
    opts.pollMs && opts.pollMs > 0
      ? setInterval(() => {
          const blocked = state.overlays.some((o) => BLOCKING.has(o.kind))
          if (busy === 0 && loads.size === 0 && !blocked) void refresh()
        }, opts.pollMs)
      : undefined
  poll?.unref?.()

  return {
    get state() {
      return state
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    init: () => track(init()),
    // Resolves once no request is in flight or queued.
    async idle() {
      for (let i = 0; i < 200; i++) {
        await chain
        await Promise.allSettled([...loads])
        await Bun.sleep(1)
        if (busy === 0 && loads.size === 0) return
      }
    },
    dispose() {
      clearInterval(poll)
      clearTimeout(toastTimer)
      listeners.clear()
    },
    quit: () => host.quit(),
    refresh: () => track(refresh()),
    toast,
    pop,

    // Board and table navigation.
    focusBy(dx: number, dy: number) {
      if (state.view === "table") {
        set((s) => ({ row: { index: Math.max(0, s.row.index + dy) } }))
        return
      }
      set((s) => {
        const at = TASK_STATUSES.indexOf(s.focus.status)
        const status = TASK_STATUSES[clamp(at + dx, TASK_STATUSES.length - 1)] ?? s.focus.status
        return { focus: { status, index: Math.max(0, s.focus.index + dy) } }
      })
    },
    focusCard(status: TaskStatus, index: number) {
      set({ focus: { status, index } })
    },
    focusRow(index: number) {
      set({ row: { index } })
    },
    // Enter: expands the Backlog rail, otherwise opens the task.
    activate() {
      if (state.view === "board" && railFocused(state)) {
        set({ backlogOpen: true })
        return
      }
      const task = targetTask(state)
      if (task) openDetail(task.id)
    },
    toggleBacklog() {
      set((s) => ({ backlogOpen: !s.backlogOpen }))
    },
    setView(view: View) {
      if (view === state.view) return
      const task = targetTask(state)
      set(
        view === "table"
          ? { view, row: { index: 0, taskId: task?.id } }
          : {
              view,
              ...(task && { focus: { status: task.status, index: 0, taskId: task.id } }),
              backlogOpen: state.backlogOpen || task?.status === "backlog",
            },
      )
    },
    sortBy(key: SortKey) {
      set((s) => ({ sort: nextSort(s.sort, key) }))
    },
    cycleAssignees(delta: -1 | 1) {
      const views = assigneeViews(
        state.me?.id,
        state.members.map((m) => m.userId),
      )
      set((s) => ({ assignees: stepAssigneeView(views, s.assignees, delta) }))
    },
    clearSearch() {
      if (state.query) set({ query: "" })
    },
    search() {
      push({
        kind: "input",
        label: "Search",
        value: state.query,
        allowEmpty: true,
        onChange: (query) => set({ query }),
        onSubmit: () => undefined,
        onCancel: () => set({ query: "" }),
      })
    },
    newTask() {
      const status =
        state.view === "board" ? state.focus.status : (targetTask(state)?.status ?? "todo")
      push({
        kind: "input",
        label: `New task in ${STATUS_LABELS[status]}`,
        value: "",
        allowEmpty: false,
        onSubmit: (title) => {
          createTask(title.trim(), status)
          return undefined
        },
      })
    },

    // Actions on the target task (the focused card, or the one open in the detail pane).
    moveBy,
    moveWithin,
    withTarget(
      action: "status" | "priority" | "me" | "due" | "copy" | "open" | "delete" | "edit" | "menu",
    ) {
      const task = targetTask(state)
      if (!task) return
      switch (action) {
        case "status":
          return statusMenu(task)
        case "priority":
          return priorityMenu(task)
        case "me":
          return toggleMe(task)
        case "due":
          return dueMenu(task)
        case "copy":
          return copy(task.key, task.key)
        case "open":
          return openInBrowser(task)
        case "delete":
          return confirmDelete(task)
        case "edit":
          return void track(editTask(task))
        case "menu":
          return taskMenu(task)
      }
    },
    pickProject: () => void pickProject(),
    pickWorkspace: () => void pickWorkspace(),
    help() {
      push({ kind: "help" })
    },
    openDetail,

    // Detail pane.
    detailScroll(o: DetailOverlay, delta: number) {
      edit(o, { scroll: Math.max(0, o.scroll + delta) })
    },
    detailItem(o: DetailOverlay, delta: -1 | 1) {
      const count = detailItems(state.details[o.taskId]).length
      if (count === 0) return
      const item = o.item < 0 ? (delta > 0 ? 0 : count - 1) : (o.item + delta + count) % count
      edit(o, { item })
    },
    // Space on a subtask: done, or back to Todo.
    detailToggle(o: DetailOverlay) {
      const item = detailItems(state.details[o.taskId])[o.item]
      if (item?.kind !== "subtask") return
      const status = item.task.status === "complete" ? "todo" : "complete"
      void update(item.task, { status })
    },
    detailOpen(o: DetailOverlay) {
      const item = detailItems(state.details[o.taskId])[o.item]
      if (item?.kind === "subtask") openDetail(item.task.id)
      else if (item?.kind === "artifact") void track(openArtifact(o.taskId, item.artifact))
    },

    // Menus, pickers, inputs, confirmations, the subtask dialog.
    menuStep(o: MenuOverlay, delta: number) {
      edit(o, { index: (o.index + delta + o.items.length) % o.items.length })
    },
    menuChoose(o: MenuOverlay, index = o.index) {
      const item = o.items[index]
      if (!item) return
      pop()
      item.run()
    },
    pickerStep(o: PickerOverlay, delta: number) {
      const count = pickerItems(o).length
      if (count > 0) edit(o, { index: (o.index + delta + count) % count })
    },
    pickerType(o: PickerOverlay, query: string) {
      edit(o, { query, index: 0 })
    },
    pickerChoose(o: PickerOverlay) {
      const item = pickerItems(o)[o.index]
      if (!item) return
      pop()
      item.run()
    },
    inputChange(o: InputOverlay, value: string) {
      edit(o, { value, error: undefined })
      o.onChange?.(value)
    },
    inputSubmit(o: InputOverlay) {
      if (!o.allowEmpty && !o.value.trim()) return
      const error = o.onSubmit(o.value)
      if (error) edit(o, { error })
      else set((s) => ({ overlays: s.overlays.filter((x) => x !== o) }))
    },
    inputCancel(o: InputOverlay) {
      set((s) => ({ overlays: s.overlays.filter((x) => x !== o) }))
      o.onCancel?.()
    },
    confirm(o: ConfirmOverlay, yes: boolean) {
      pop()
      if (yes) o.onYes()
    },
    syncStep(o: SyncOverlay, delta: number) {
      edit(o, { index: (o.index + delta + o.subtasks.length) % o.subtasks.length })
    },
    syncCycle(o: SyncOverlay, delta: -1 | 1) {
      const sub = o.subtasks[o.index]
      if (!sub) return
      const current = o.picked[sub.id] ?? sub.status
      const at = TASK_STATUSES.indexOf(current) + delta
      const next = TASK_STATUSES[(at + TASK_STATUSES.length) % TASK_STATUSES.length] ?? current
      edit(o, { picked: { ...o.picked, [sub.id]: next } })
    },
    syncAll(o: SyncOverlay) {
      edit(o, { picked: Object.fromEntries(o.subtasks.map((s) => [s.id, o.status])) })
    },
    syncApply(o: SyncOverlay) {
      pop()
      const changed = o.subtasks.filter((s) => (o.picked[s.id] ?? s.status) !== s.status)
      for (const s of changed) {
        const status = o.picked[s.id]
        if (status) void update(s, { status })
      }
      if (changed.length > 0) toast(`Updated ${plural(changed.length, "subtask")}`)
    },
    top,
  }
}

export type Store = ReturnType<typeof createStore>
