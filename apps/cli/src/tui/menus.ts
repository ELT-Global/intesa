// The menus and prompts that act on one task: the actions menu (m) and what s, p, d and x open.
import { isRealDate } from "@intesa/api/schemas"
import {
  dayFromToday,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
} from "@intesa/task-query"
import { plural, type Task } from "./api"
import type { Core, MenuItem } from "./state"
import type { Writes } from "./writes"

export function createMenus(core: Core, writes: Writes, openDetail: (taskId: string) => void) {
  const { api, host, get, push, toast } = core
  const { update, moveTo, toggleMe, removeTask, editTask } = writes

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

  const copyKey = (task: Task) => copy(task.key, task.key)
  function copy(text: string, what: string) {
    toast(host.copy(text) ? `Copied ${what}` : "Could not copy to the clipboard", false)
  }

  function openInBrowser(task: Task) {
    const url = api.taskUrl(get().workspace.slug, task)
    toast(api.openUrl(url) ? `Opening ${task.key} in your browser` : `Open ${url}`)
  }

  function taskMenu(task: Task) {
    const me = get().me
    const mine = !!me && task.assignees.some((a) => a.id === me.id)
    menu(`${task.key}`, [
      { label: "Open", key: "enter", run: () => openDetail(task.id) },
      { label: "Status…", key: "s", run: () => statusMenu(task) },
      { label: "Priority…", key: "p", run: () => priorityMenu(task) },
      { label: mine ? "Unassign me" : "Assign to me", key: "a", run: () => toggleMe(task) },
      { label: "Due date…", key: "d", run: () => dueMenu(task) },
      { label: "Edit title and description", key: "e", run: () => editTask(task) },
      { label: "Copy key", key: "y", run: () => copyKey(task) },
      {
        label: "Copy link",
        key: "l",
        run: () => copy(api.taskUrl(get().workspace.slug, task), "link"),
      },
      { label: "Open in browser", key: "o", run: () => openInBrowser(task) },
      { label: "Delete…", key: "x", run: () => confirmDelete(task) },
    ])
  }

  return {
    taskMenu,
    statusMenu,
    priorityMenu,
    dueMenu,
    confirmDelete,
    copyKey,
    openInBrowser,
  }
}
