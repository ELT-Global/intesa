// Changes to tasks: shown at once, sent one at a time, put back if the server says no.
import { isInPlace, type Placement, STATUS_LABELS, type TaskStatus } from "@intesa/task-query"
import type { Artifact, Task, TaskDetail, TaskPatch } from "./api"
import { fromDoc, toDoc } from "./edit-doc"
import { applyChanges, type Changes, nextStatus, revert } from "./model"
import {
  type Core,
  DRAFT,
  detailItems,
  patchDetails,
  type State,
  selectedTask,
  shownTasks,
  targetTask,
  taskById,
  withSubtask,
} from "./state"

const MARKDOWN = "text/markdown"

export function createWrites(core: Core, settled: () => void) {
  const { api, host, get, set, track, push, toast, failed } = core

  // Writes run one at a time, so responses cannot land out of order. Each one bumps `epoch`,
  // so a read that was sent before it can tell that its answer is out of date.
  let busy = 0
  let epoch = 0
  // Files being sent right now; quitting waits for them without a limit.
  let uploading = 0
  let chain: Promise<unknown> = Promise.resolve()
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    busy++
    epoch++
    const run = chain.then(work).finally(() => {
      busy--
      if (busy === 0) settled()
    })
    chain = run.catch(() => {})
    return run
  }

  /** Applies `patch` at once, sends it, and puts things back if the server says no. */
  function update(task: Task, patch: TaskPatch, view: Changes = {}): Promise<boolean> {
    const changes: Changes = { ...view }
    for (const k of ["title", "body", "status", "priority", "dueAt"] as const) {
      if (patch[k] !== undefined) Object.assign(changes, { [k]: patch[k] })
    }
    const { list, undo } = applyChanges(get().tasks, task.id, changes, patch.placement)
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
      if (!placement || isInPlace(get().tasks, task, placement)) return
      void update(task, { placement })
      return
    }
    const followed = get().focus.taskId === task.id
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
    if (taskById(get(), taskId)?.status !== status) return
    if (!detail.subtasks.some((s) => s.status !== status)) return
    push({ kind: "sync", task: detail, status, subtasks: detail.subtasks, picked: {}, index: 0 })
  }

  function moveBy(delta: -1 | 1) {
    const task = targetTask(get())
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
    const s = get()
    if (s.overlays.length > 0) return toast("Close the task (esc) to reorder it")
    if (s.view !== "board") return toast("Cards are reordered on the board (b)")
    const task = targetTask(s)
    if (!task) return
    const column = shownTasks(s).filter((t) => t.status === task.status)
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
    const me = get().me
    if (!me) return
    const mine = task.assignees.some((a) => a.id === me.id)
    const next = mine
      ? task.assignees.filter((a) => a.id !== me.id)
      : [...task.assignees, { id: me.id, name: me.name, avatarUrl: me.avatarUrl ?? null }]
    void update(task, { assigneeIds: next.map((a) => a.id) }, { assignees: next })
  }

  function createTask(projectId: string, title: string, status: TaskStatus, assigneeIds: string[]) {
    void enqueue(async () => {
      try {
        const task = await api.create(projectId, { title, status, assigneeIds })
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

  // Selects a subtask in its parent's open pane.
  function select(s: State, parentId: string, subId: string) {
    const items = detailItems(s.details[parentId])
    const item = items.findIndex((i) => i.kind === "subtask" && i.task.id === subId)
    return s.overlays.map((o) =>
      o.kind === "detail" && o.taskId === parentId ? { ...o, item } : o,
    )
  }

  // Shown at once and selected, as the last subtask (where the server lists it), then swapped
  // for the server's; taken back if it says no.
  let drafts = 0
  function createSubtask(parent: Task, title: string) {
    const now = new Date().toISOString()
    const draft: Task = {
      id: `${DRAFT}${++drafts}`,
      projectId: parent.projectId,
      number: 0,
      key: "new",
      title,
      body: null,
      status: "todo",
      priority: null,
      dueAt: null,
      parentTaskId: parent.id,
      assignees: [],
      tags: [],
      subtaskCount: 0,
      subtaskDoneCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    set((s) => {
      const next = { ...s, ...withSubtask(s, draft, 1) }
      return { ...next, overlays: select(next, parent.id, draft.id) }
    })
    void enqueue(async () => {
      try {
        const task = await api.create(parent.projectId, {
          title,
          status: "todo",
          parentTaskId: parent.id,
        })
        set((s) => {
          const at = s.details[parent.id]?.task?.subtasks.findIndex((t) => t.id === draft.id) ?? -1
          const without = { ...s, ...withSubtask(s, draft, -1) }
          return withSubtask(without, task, 1, at >= 0 ? at : undefined)
        })
        toast(`Created ${task.key}`)
      } catch (err) {
        set((s) => ({
          ...withSubtask(s, draft, -1),
          overlays: s.overlays.map((o) =>
            o.kind === "detail" && selectedTask(s, o)?.id === draft.id ? { ...o, item: -1 } : o,
          ),
        }))
        failed("Could not create the subtask", err)
      }
    })
  }

  // A task leaves the board, a subtask its parent's pane (where nothing is selected after it,
  // rather than whatever moved into its place); either is put back if the server says no.
  function removeTask(task: Task) {
    const s0 = get()
    const index = s0.tasks.findIndex((t) => t.id === task.id)
    const parentId = task.parentTaskId
    const subIndex = parentId
      ? (s0.details[parentId]?.task?.subtasks.findIndex((t) => t.id === task.id) ?? -1)
      : -1
    set((s) => {
      const left = parentId ? withSubtask(s, task, -1) : s
      return {
        tasks: left.tasks.filter((t) => t.id !== task.id),
        details: left.details,
        overlays: s.overlays
          .filter((o) => !(o.kind === "detail" && o.taskId === task.id))
          .map((o) =>
            o.kind === "detail" && selectedTask(s, o)?.id === task.id ? { ...o, item: -1 } : o,
          ),
      }
    })
    void enqueue(async () => {
      try {
        await api.remove(task.id)
        toast(`Deleted ${task.key}`)
      } catch (err) {
        if (index >= 0) {
          set((s) => ({ tasks: [...s.tasks.slice(0, index), task, ...s.tasks.slice(index)] }))
        }
        if (parentId) set((s) => withSubtask(s, task, 1, subIndex >= 0 ? subIndex : undefined))
        failed(`Could not delete ${task.key}`, err)
      }
    })
  }

  /**
   * Uploads the files typed, one after another as the web does, once all of them have passed
   * the checks the server would make. Returns why not, to keep the prompt open.
   */
  function uploadArtifacts(taskId: string, input: string): string | undefined {
    const files = api.localFiles(input)
    if (typeof files === "string") return files
    void enqueue(async () => {
      for (const file of files) {
        uploading++
        try {
          const artifact = await api.uploadArtifact(taskId, file)
          set((s) => {
            const entry = s.details[taskId]
            if (!entry) return {}
            const artifacts = [...entry.artifacts.filter((a) => a.id !== artifact.id), artifact]
            return { details: { ...s.details, [taskId]: { ...entry, artifacts } } }
          })
        } catch (err) {
          failed(`Could not upload ${file.name}`, err)
          return
        } finally {
          uploading--
        }
      }
      const [only] = files
      toast(
        files.length === 1 && only ? `Uploaded ${only.name}` : `Uploaded ${files.length} artifacts`,
      )
    })
    return undefined
  }

  // The editor's own failures are local and meant for people, so their text is shown.
  async function inEditor(text: string, filename: string, what: string) {
    try {
      return await host.suspend(() => api.edit(text, filename))
    } catch (err) {
      toast(`Could not edit ${what}: ${(err as Error).message}`, true)
      return undefined
    }
  }

  async function editTask(task: Task) {
    const saved = await inEditor(toDoc(task.title, task.body), `${task.key}.md`, task.key)
    if (saved === undefined) return
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

  // Markdown opens in the editor and is saved back; anything else opens in the browser.
  async function openArtifact(taskId: string, artifact: Artifact) {
    if (artifact.mimeType !== MARKDOWN) {
      const url = api.artifactUrl(taskId, artifact.id)
      toast(api.openUrl(url) ? `Opening ${artifact.name} in your browser` : `Open ${url}`)
      return
    }
    let text: string
    try {
      text = await track(api.artifactText(taskId, artifact.id))
    } catch (err) {
      failed(`Could not open ${artifact.name}`, err)
      return
    }
    const edited = await inEditor(text, artifact.name, artifact.name)
    if (edited === undefined) return
    if (edited === text) {
      toast("No changes")
      return
    }
    const saved = await enqueue(async () => {
      try {
        await api.saveArtifact(taskId, artifact, edited)
        return true
      } catch (err) {
        failed(`Could not save ${artifact.name}`, err)
        return false
      }
    })
    if (saved) toast(`Saved ${artifact.name}`)
  }

  return {
    update,
    moveTo,
    moveBy,
    moveWithin,
    toggleMe,
    createTask,
    createSubtask,
    removeTask,
    uploadArtifacts,
    editTask: (task: Task) => void track(editTask(task)),
    openArtifact: (taskId: string, artifact: Artifact) =>
      void track(openArtifact(taskId, artifact)),
    /** A mark for a read about to be sent: `current(mark)` says whether its answer still is. */
    mark: () => epoch,
    current: (mark: number) => busy === 0 && mark === epoch,
    // The queue while it runs, for polling and tests.
    pending: () => (busy > 0 ? [chain] : []),
    /**
     * Resolves true once the queued writes have settled, false if that takes over `ms`. An
     * upload in flight is waited for however long it takes (its requests time out on their
     * own), then `ms` more for what is queued after it: a large file can take a while.
     */
    async flush(ms: number): Promise<boolean> {
      for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const late = new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), ms)
        })
        const settled = await Promise.race([chain.then(() => true), late]).finally(() =>
          clearTimeout(timer),
        )
        if (settled || uploading === 0) return settled
      }
    },
  }
}

export type Writes = ReturnType<typeof createWrites>
