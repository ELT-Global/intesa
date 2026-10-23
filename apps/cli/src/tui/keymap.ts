// Keys to store actions. Mirrors the web board's shortcuts, with terminal-safe alternates:
// terminals (and Windows Terminal's own Alt+Arrow bindings) make some combinations unreliable.
import type { SortKey } from "@intesa/task-query"
import type { Task } from "./api"
import {
  type ConfirmOverlay,
  type DetailOverlay,
  type InputOverlay,
  type MenuOverlay,
  type MoveOverlay,
  type PickerOverlay,
  type SyncOverlay,
  targetTask,
} from "./state"
import { POLL_MS, type Store } from "./store"

export type Key = {
  name: string
  sequence: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option?: boolean
}

// The help overlay lists these, in this order.
export const HELP: [keys: string, what: string][] = [
  ["← ↓ ↑ → / h j k l", "Move between cards"],
  ["enter", "Open the task (or the Backlog rail)"],
  [
    "alt+← → / < >",
    "Move the card to the previous or next column (may ask who did it, reviewed, tested)",
  ],
  ["alt+↑ ↓ / K J", "Move the card up or down in its column"],
  ["shift+← →", "Switch assignee filter: me, each member, unassigned, everyone"],
  ["/ or f", "Search (status:, assignee:, tag:, priority:, due:, has:, no:)"],
  ["n or c", "New task in the focused column (open task: a subtask)"],
  ["m", "Actions menu"],
  ["s / p / d", "Status, priority, due date"],
  ["a", "Assign or unassign me"],
  ["e", "Edit title and description in $EDITOR"],
  ["y / o", "Copy the task key, or open it in the browser"],
  ["x", "Delete the task (open task: the selected subtask, if any)"],
  ["t / b", "Table or board view"],
  ["1 2 3 4", "Table: sort by task, status, priority, due (again to reverse)"],
  ["[", "Show or hide Backlog"],
  ["P / W", "Switch project or workspace"],
  ["r", `Refresh (also every ${POLL_MS / 1000} s, and after each change)`],
  ["↑ ↓ / pgup pgdn", "Open task: scroll"],
  ["tab / shift+tab", "Open task: select a subtask or artifact"],
  ["space", "Open task: tick the selected subtask off, or back to Todo"],
  ["enter", "Open task: open the selected subtask (e edits it there) or artifact"],
  ["u", "Open task: upload files as artifacts (quote paths with spaces)"],
  ["esc", "Close, go back, or clear the search"],
  ["?", "This help"],
  ["q / ctrl+c", "Quit (q closes an open task first)"],
]

const alt = (k: Key) => k.meta || Boolean(k.option)
const plain = (k: Key) => !alt(k) && !k.ctrl && !k.shift
const SORT_KEYS: Record<string, SortKey> = {
  "1": "task",
  "2": "status",
  "3": "priority",
  "4": "due",
}

// A typed character, for text inputs.
const printable = (k: Key) =>
  !k.ctrl &&
  !alt(k) &&
  k.sequence.length > 0 &&
  [...k.sequence].every((ch) => ch >= " " && ch !== "\u007f")
    ? k.sequence
    : undefined

export function handleKey(store: Store, k: Key) {
  if (k.ctrl && k.name === "c") return store.quit()
  const top = store.top()
  switch (top?.kind) {
    case "input":
      return inputKey(store, top, k)
    case "picker":
      return pickerKey(store, top, k)
    case "menu":
      return menuKey(store, top, k)
    case "confirm":
      return confirmKey(store, top, k)
    case "sync":
      return syncKey(store, top, k)
    case "move":
      return moveKey(store, top, k)
    case "help":
      if (k.name === "escape" || k.name === "?" || k.name === "q" || k.name === "return") {
        store.pop()
      }
      return
    case "detail":
      if (detailKey(store, top, k)) return
      if (taskKey(store, k) || globalKey(store, k)) return
      return
  }
  if (taskKey(store, k) || globalKey(store, k)) return
  boardKey(store, k)
}

// Plain letters for what acts on one task.
const TASK_ACTIONS: Record<string, (store: Store, task: Task) => void> = {
  m: (store, task) => store.taskMenu(task),
  s: (store, task) => store.statusMenu(task),
  p: (store, task) => store.priorityMenu(task),
  a: (store, task) => store.toggleMe(task),
  d: (store, task) => store.dueMenu(task),
  y: (store, task) => store.copyKey(task),
  o: (store, task) => store.openInBrowser(task),
  x: (store, task) => store.confirmDelete(task),
  e: (store, task) => store.editTask(task),
}

// Keys that act on the focused card or the task open in the detail pane.
function taskKey(store: Store, k: Key): boolean {
  if (alt(k) && (k.name === "left" || k.name === "right")) {
    store.moveBy(k.name === "left" ? -1 : 1)
    return true
  }
  if (alt(k) && (k.name === "up" || k.name === "down")) {
    store.moveWithin(k.name === "up" ? -1 : 1)
    return true
  }
  if (k.name === "<" || k.name === ">") {
    store.moveBy(k.name === "<" ? -1 : 1)
    return true
  }
  if (k.shift && !alt(k) && !k.ctrl && (k.name === "k" || k.name === "j")) {
    store.moveWithin(k.name === "k" ? -1 : 1)
    return true
  }
  const action = plain(k) ? TASK_ACTIONS[k.name] : undefined
  if (!action) return false
  const task = targetTask(store.state)
  if (task) action(store, task)
  return true
}

function globalKey(store: Store, k: Key): boolean {
  if (k.name === "?") store.help()
  else if (plain(k) && k.name === "q") store.quit()
  else if (plain(k) && k.name === "r") void store.refresh()
  else return false
  return true
}

function boardKey(store: Store, k: Key) {
  const { view } = store.state
  if (k.shift && !alt(k) && (k.name === "left" || k.name === "right")) {
    store.cycleAssignees(k.name === "left" ? -1 : 1)
    return
  }
  if (k.shift && k.name === "p") return store.pickProject()
  if (k.shift && k.name === "w") return store.pickWorkspace()
  if (alt(k) || k.ctrl || k.shift) return
  switch (k.name) {
    case "left":
    case "h":
      return store.focusBy(-1, 0)
    case "right":
    case "l":
      return store.focusBy(1, 0)
    case "up":
    case "k":
      return store.focusBy(0, -1)
    case "down":
    case "j":
      return store.focusBy(0, 1)
    case "return":
    case "linefeed":
      return store.activate()
    case "n":
    case "c":
      return store.newTask()
    case "/":
    case "f":
      return store.search()
    case "t":
      return store.setView("table")
    case "b":
      return store.setView("board")
    case "[":
      return store.toggleBacklog()
    case "escape":
      return store.clearSearch()
  }
  const sort = SORT_KEYS[k.name]
  if (view === "table" && sort) store.sortBy(sort)
}

function detailKey(store: Store, o: DetailOverlay, k: Key): boolean {
  if (alt(k) || k.ctrl) return false
  switch (k.name) {
    case "escape":
      store.pop()
      return true
    // As in menus and help, q closes what is open rather than the whole board.
    case "q":
      if (k.shift) return false
      store.pop()
      return true
    case "up":
    case "k":
      if (k.shift) return false
      store.detailScroll(o, -1)
      return true
    case "down":
    case "j":
      if (k.shift) return false
      store.detailScroll(o, 1)
      return true
    case "pageup":
      store.detailScroll(o, -10)
      return true
    case "pagedown":
      store.detailScroll(o, 10)
      return true
    case "tab":
      store.detailItem(o, k.shift ? -1 : 1)
      return true
    case "space":
      store.detailToggle(o)
      return true
    case "return":
    case "linefeed":
      store.detailOpen(o)
      return true
  }
  if (!plain(k)) return false
  switch (k.name) {
    case "n":
    case "c":
      store.newSubtask(o)
      return true
    case "u":
      store.upload(o)
      return true
    case "x":
      return store.detailDelete(o)
  }
  return false
}

function inputKey(store: Store, o: InputOverlay, k: Key) {
  if (k.name === "escape") return store.inputCancel(o)
  if (k.name === "return" || k.name === "linefeed") return store.inputSubmit(o)
  if (k.name === "backspace") return store.inputChange(o, [...o.value].slice(0, -1).join(""))
  if (k.ctrl && k.name === "u") return store.inputChange(o, "")
  if (k.ctrl && k.name === "w") return store.inputChange(o, o.value.replace(/\S*\s*$/, ""))
  const ch = printable(k)
  if (ch) store.inputChange(o, o.value + ch)
}

function pickerKey(store: Store, o: PickerOverlay, k: Key) {
  if (k.name === "escape") return store.pop()
  if (k.name === "return" || k.name === "linefeed") return store.pickerChoose(o)
  if (k.name === "up" || (k.ctrl && k.name === "p")) return store.pickerStep(o, -1)
  if (k.name === "down" || (k.ctrl && k.name === "n")) return store.pickerStep(o, 1)
  if (k.name === "backspace") return store.pickerType(o, [...o.query].slice(0, -1).join(""))
  const ch = printable(k)
  if (ch) store.pickerType(o, o.query + ch)
}

function menuKey(store: Store, o: MenuOverlay, k: Key) {
  if (k.name === "escape" || (plain(k) && k.name === "q")) return store.pop()
  if (k.name === "return" || k.name === "linefeed") return store.menuChoose(o)
  if (k.name === "up" || (plain(k) && k.name === "k")) return store.menuStep(o, -1)
  if (k.name === "down" || (plain(k) && k.name === "j")) return store.menuStep(o, 1)
  const at = o.items.findIndex((i) => i.key === k.name && plain(k))
  if (at >= 0) store.menuChoose(o, at)
}

// Letters count only unmodified, so Ctrl+Y or Alt+Y does not delete.
function confirmKey(store: Store, o: ConfirmOverlay, k: Key) {
  const enter = k.name === "return" || k.name === "linefeed"
  if (enter || (plain(k) && k.name === "y")) store.confirm(o, true)
  else if (k.name === "escape" || (plain(k) && (k.name === "n" || k.name === "q"))) {
    store.confirm(o, false)
  }
}

// Up and down pick the question, left and right its answer.
function moveKey(store: Store, o: MoveOverlay, k: Key) {
  if (k.name === "escape") return store.pop()
  if (k.name === "return" || k.name === "linefeed") return store.moveApply(o)
  if (alt(k) || k.ctrl) return
  if (k.name === "up" || (plain(k) && k.name === "k")) return store.moveStep(o, -1)
  if (k.name === "down" || (plain(k) && k.name === "j")) return store.moveStep(o, 1)
  if (k.name === "left" || (plain(k) && k.name === "h")) return store.moveCycle(o, -1)
  if (k.name === "right" || (plain(k) && k.name === "l") || k.name === "space") {
    return store.moveCycle(o, 1)
  }
}

function syncKey(store: Store, o: SyncOverlay, k: Key) {
  if (k.name === "escape") return store.pop()
  if (k.name === "return" || k.name === "linefeed") return store.syncApply(o)
  if (alt(k) || k.ctrl) return
  if (k.name === "up" || (plain(k) && k.name === "k")) return store.syncStep(o, -1)
  if (k.name === "down" || (plain(k) && k.name === "j")) return store.syncStep(o, 1)
  if (k.name === "left" || (plain(k) && k.name === "h")) return store.syncCycle(o, -1)
  if (k.name === "right" || (plain(k) && k.name === "l") || k.name === "space") {
    return store.syncCycle(o, 1)
  }
  if (plain(k) && k.name === "a") store.syncAll(o)
}
