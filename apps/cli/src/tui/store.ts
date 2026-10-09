// The board's state and every action on it. Rendering subscribes to changes; nothing here
// knows about the terminal except through `Host`, so it runs the same under the test renderer.
import {
  assigneeViews,
  matchesAssignees,
  newTaskAssignees,
  nextSort,
  type SortKey,
  STATUS_LABELS,
  stepAssigneeView,
  TASK_STATUSES,
  type TaskStatus,
} from "@intesa/task-query"
import {
  type BoardApi,
  type Field,
  type Project,
  plural,
  reasonOf,
  type Start,
  type Workspace,
} from "./api"
import { createMenus } from "./menus"
import {
  type ConfirmOverlay,
  type Core,
  clamp,
  type DetailOverlay,
  detailItems,
  type Host,
  type InputOverlay,
  type MenuOverlay,
  normalize,
  type Overlay,
  type PickerOverlay,
  pickerItems,
  railFocused,
  type State,
  type SyncOverlay,
  targetTask,
  type View,
} from "./state"
import { createWrites } from "./writes"

export const POLL_MS = 30_000
// While these are open the board does not poll: a refresh could move what they are about.
const BLOCKING = new Set(["input", "menu", "picker", "confirm", "sync"])

// What could not be saved by the time the board closed, with the error that said so.
export type Lost = { text: string; err?: unknown }

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
  const scrollers = new Set<(o: DetailOverlay, delta: number) => void>()

  function set(next: Partial<State> | ((s: State) => Partial<State>)) {
    state = normalize({ ...state, ...(typeof next === "function" ? next(state) : next) })
    for (const fn of listeners) fn()
  }

  // Requests the store is waiting on, so polling (and tests) can tell when it is idle.
  const loads = new Set<Promise<unknown>>()
  function track<T>(p: Promise<T>): Promise<T> {
    loads.add(p)
    p.then(
      () => loads.delete(p),
      () => loads.delete(p),
    )
    return p
  }

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function toast(text: string, error = false) {
    clearTimeout(toastTimer)
    set({ toast: { text, error } })
    toastTimer = setTimeout(() => set({ toast: undefined }), error ? 6000 : 3000)
    toastTimer.unref?.()
  }
  // Set once the user quits: failures from then on are kept to print after the board is gone.
  let lost: Lost[] | undefined
  function failed(what: string, err: unknown) {
    const reason = reasonOf(err)
    const text = reason ? `${what}: ${reason}` : `${what}.`
    lost?.push({ text, err })
    toast(text, true)
  }

  // --- Overlays ---
  const push = (o: Overlay) => set((s) => ({ overlays: [...s.overlays, o] }))
  const pop = () => set((s) => ({ overlays: s.overlays.slice(0, -1) }))
  // Replaces an overlay with an edited copy of itself.
  function edit<O extends Overlay>(o: O, change: Partial<O>) {
    set((s) => ({ overlays: s.overlays.map((x) => (x === o ? { ...o, ...change } : x)) }))
  }
  const remove = (o: Overlay) => set((s) => ({ overlays: s.overlays.filter((x) => x !== o) }))
  const top = () => state.overlays.at(-1)

  const core: Core = {
    api,
    host,
    get: () => state,
    set,
    track,
    push,
    toast,
    failed,
  }
  const writes = createWrites(core, () => void refresh())
  const menus = createMenus(core, writes, openDetail)

  // --- Loading ---
  // Answers are dropped when a later refresh was sent, or a write was made, after they were
  // asked for: either way they are older than what the board shows.
  let refreshes = 0
  async function refresh() {
    const project = state.project
    if (!project) return
    for (const o of state.overlays) if (o.kind === "detail") void loadDetail(o.taskId)
    const seq = ++refreshes
    const mark = writes.mark()
    try {
      const tasks = await track(api.tasks(project.id))
      if (seq !== refreshes || !writes.current(mark) || state.project?.id !== project.id) return
      set({ tasks, loaded: true, error: undefined })
    } catch (err) {
      if (seq !== refreshes) return
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

  const detailLoads: Record<string, number> = {}
  async function loadDetail(taskId: string) {
    const seq = (detailLoads[taskId] ?? 0) + 1
    detailLoads[taskId] = seq
    const mark = writes.mark()
    try {
      const [task, artifacts, history] = await track(
        Promise.all([api.task(taskId), api.artifacts(taskId), api.history(taskId)]),
      )
      if (detailLoads[taskId] !== seq || !writes.current(mark)) return
      set((s) => ({ details: { ...s.details, [taskId]: { task, artifacts, history } } }))
    } catch (err) {
      if (detailLoads[taskId] !== seq) return
      const reason = reasonOf(err) ?? "Could not load the task."
      set((s) => {
        const prev = s.details[taskId] ?? { artifacts: [], history: [] }
        return { details: { ...s.details, [taskId]: { ...prev, error: reason } } }
      })
    }
  }

  function openDetail(taskId: string) {
    push({ kind: "detail", taskId, item: -1 })
    void loadDetail(taskId)
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
      if (task) {
        // Someone else's task is shown with everyone's, so the focus can land on it.
        const assignees = matchesAssignees(task, state.assignees) ? state.assignees : []
        set({ assignees, focus: { status: task.status, index: 0, taskId: task.id } })
      }
      openDetail(start.openTask)
    }
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
      items: projects.map((p) => ({
        label: `${p.key}  ${p.name}`,
        run: () => void track(openProject(p)),
      })),
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
        run: () => void track(switchWorkspace({ id: w.id, slug: w.slug })),
      })),
    })
  }

  // --- Polling ---
  const poll =
    opts.pollMs && opts.pollMs > 0
      ? setInterval(() => {
          const blocked = state.overlays.some((o) => BLOCKING.has(o.kind))
          if (writes.pending().length === 0 && loads.size === 0 && !blocked) void track(refresh())
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
    // The view keeps the detail pane's scroll position: only it knows how long the pane is.
    onDetailScroll(fn: (o: DetailOverlay, delta: number) => void) {
      scrollers.add(fn)
      return () => scrollers.delete(fn)
    },
    init: () => track(init()),
    // Requests in flight and queued writes, for tests.
    pending: (): Promise<unknown>[] => [...loads, ...writes.pending()],
    /**
     * Waits up to `ms` for the writes still queued, and returns what they could not save: once
     * the board is gone, a failure can no longer be shown on it.
     */
    async close(ms: number): Promise<Lost[]> {
      lost = []
      const settled = await writes.flush(ms)
      if (!settled) {
        lost.push({
          text: "The board closed while changes were still being saved; they may be lost.",
        })
      }
      return lost
    },
    dispose() {
      clearInterval(poll)
      clearTimeout(toastTimer)
      listeners.clear()
      scrollers.clear()
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
    // Esc puts back the search there was before, so an earlier one is not lost.
    search() {
      const before = state.query
      push({
        kind: "input",
        label: "Search",
        value: state.query,
        allowEmpty: true,
        onChange: (query) => set({ query }),
        onSubmit: () => undefined,
        onCancel: () => set({ query: before }),
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
          const project = state.project
          if (project) {
            const assignees = newTaskAssignees(state.assignees, state.me?.id)
            writes.createTask(project.id, title.trim(), status, assignees)
          }
          return undefined
        },
      })
    },

    // Actions on a task: the focused card, or the one open in the detail pane.
    moveBy: writes.moveBy,
    moveWithin: writes.moveWithin,
    toggleMe: writes.toggleMe,
    editTask: writes.editTask,
    ...menus,
    pickProject: () => void track(pickProject()),
    pickWorkspace: () => void track(pickWorkspace()),
    help() {
      push({ kind: "help" })
    },
    openDetail,

    // Detail pane.
    detailScroll(o: DetailOverlay, delta: number) {
      for (const fn of scrollers) fn(o, delta)
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
      void writes.update(item.task, { status })
    },
    detailOpen(o: DetailOverlay) {
      const item = detailItems(state.details[o.taskId])[o.item]
      if (item?.kind === "subtask") openDetail(item.task.id)
      else if (item?.kind === "artifact") writes.openArtifact(o.taskId, item.artifact)
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
      else remove(o)
    },
    inputCancel(o: InputOverlay) {
      remove(o)
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
        if (status) void writes.update(s, { status })
      }
      if (changed.length > 0) toast(`Updated ${plural(changed.length, "subtask")}`)
    },
    top,
  }
}

export type Store = ReturnType<typeof createStore>
