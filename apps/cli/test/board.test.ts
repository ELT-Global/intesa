import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { session } from "../src/tui/app"
import { THEME } from "../src/tui/view/kit"
import {
  type Board,
  type BoardWorld,
  boardWorld,
  columnKeys,
  columnLines,
  openBoard,
  removeBoardDirs,
  rows,
  until,
} from "./board-world"
import { startServer, type TestServer } from "./helpers"

// Temp directories the tests make, removed at the end.
const temps: string[] = []
function tempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeBoardDirs()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const open: Board[] = []
afterEach(() => {
  for (const b of open.splice(0)) b.close()
})
async function board(w: BoardWorld, opts?: Parameters<typeof openBoard>[1]) {
  const b = await openBoard(w, opts)
  open.push(b)
  return b
}

// Todo reads WEB-3, WEB-2, WEB-1: new tasks go to the top of their column.
async function threeTodos(w: BoardWorld) {
  const one = await w.addTask({ title: "One", assigneeIds: [w.me] })
  const two = await w.addTask({ title: "Two", assigneeIds: [w.me] })
  const three = await w.addTask({ title: "Three", assigneeIds: [w.me] })
  return { one, two, three }
}

// An $EDITOR that replaces `from` with `to` in the file it is given.
async function replacingEditor(from: string, to: string) {
  const dir = tempDir("intesa-board-editor-")
  const script = join(dir, "editor.js")
  await Bun.write(
    script,
    `const path = process.argv[2]
const text = await Bun.file(path).text()
await Bun.write(path, text.replace(${JSON.stringify(from)}, ${JSON.stringify(to)}))`,
  )
  return `"${process.execPath}" "${script}"`
}

const overlays = (b: Board) => b.store.state.overlays.map((o) => o.kind)

describe("board: layout", () => {
  test("columns with counts, the Backlog rail, and cards with their details", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({
      title: "Login 2FA",
      status: "in_progress",
      priority: "high",
      assigneeIds: [w.me],
    })
    await w.addTask({ title: "Kid", parentTaskId: parent.id })
    await w.addTask({ title: "Fix redirect", assigneeIds: [w.me], priority: "low" })
    await w.addTask({ title: "Tag colors", status: "review", assigneeIds: [w.me] })
    await w.addTask({ title: "Someday", status: "backlog", assigneeIds: [w.me] })
    const b = await board(w)
    const frame = await b.frame()
    const [head, top, ...rest] = rows(frame)

    expect(head).toStartWith(` ${w.workspace.slug} / WEB · Board`)
    expect(head).toEndWith("filter: @me · ? help")
    // A folded Backlog rail with its count, then the four columns.
    expect(top).toMatch(
      /^╭─╮╭─ Todo \(1\) ─+╮╭─ In progress \(1\) ─+╮╭─ Review \(1\) ─+╮╭─ Complete \(0\) ─+╮$/,
    )
    expect(
      rest
        .slice(0, 9)
        .map((r) => r[1])
        .join(""),
    ).toBe("1 Backlog")
    expect(rest.at(-1)).toContain("n new · / search · enter open · alt+←→ move")

    // The focused card is marked; the second line has priority, people, subtask progress.
    expect(columnLines(frame, "Todo")).toEqual(["▌WEB-3 Fix redirect", "▌↓ @alan"])
    expect(columnLines(frame, "In progress")).toEqual(["WEB-1 Login 2FA", "↑ @alan ☐ 0/1"])
    expect(columnLines(frame, "Review")).toEqual(["WEB-4 Tag colors", "@alan"])
    expect(columnLines(frame, "Complete")).toEqual(["No tasks"])
  })

  test("a title written like a conventional commit shows its type and scope in the type's colour", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "fix(api): lost ips", assigneeIds: [w.me] })
    await w.addTask({ title: "feat: sub-batches", assigneeIds: [w.me] })
    await w.addTask({ title: "Fix fee policy", assigneeIds: [w.me] })
    const b = await board(w, { color: true })
    const spans = (await b.spans()).lines.flatMap((l) => l.spans)
    const colour = (text: string) => {
      const span = spans.find((s) => s.text.trimEnd() === text)
      if (!span) throw new Error(`no span "${text}" in ${spans.map((s) => s.text).join("|")}`)
      return span.fg.toInts().slice(0, 3)
    }
    const theme = (hex: string) => RGBA.fromHex(hex).toInts().slice(0, 3)

    expect(colour("fix(api):")).toEqual(theme(THEME.intent.red))
    expect(colour("feat:")).toEqual(theme(THEME.intent.green))
    expect(colour(" lost ips")).not.toEqual(theme(THEME.intent.red))
    expect(colour("Fix fee policy")).not.toEqual(theme(THEME.intent.red))
  })

  test("a long column scrolls with the focus and says how many cards are out of view", async () => {
    const w = await boardWorld(server)
    for (let i = 1; i <= 8; i++) await w.addTask({ title: `Card ${i}`, assigneeIds: [w.me] })
    const b = await board(w, { height: 14 })
    let frame = await b.frame()
    // 10 rows inside the column: three cards of two lines with gaps.
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-8", "WEB-7", "WEB-6"])
    expect(frame).toContain(" ↓5 ─╯")
    for (let i = 0; i < 4; i++) await b.press("j")
    frame = await b.frame()
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-6", "WEB-5", "WEB-4"])
    expect(columnLines(frame, "Todo")[4]).toBe("▌WEB-4 Card 4")
    expect(frame).toContain(" ↑2 ↓3 ─╯")
  })
})

describe("board: navigation and detail", () => {
  test("arrows and hjkl move the focus between cards and columns", async () => {
    const w = await boardWorld(server)
    await threeTodos(w)
    await w.addTask({ title: "Doing", status: "in_progress", assigneeIds: [w.me] })
    const b = await board(w)
    const focused = (frame: string) =>
      rows(frame)
        .flatMap((r) => [...r.matchAll(/▌(WEB-\d+) /g)].map((m) => m[1]))
        .at(0)
    expect(focused(await b.frame())).toBe("WEB-3")
    expect(focused(await b.arrow("down"))).toBe("WEB-2")
    expect(focused(await b.press("j"))).toBe("WEB-1")
    expect(focused(await b.press("j"))).toBe("WEB-1")
    expect(focused(await b.press("k"))).toBe("WEB-2")
    expect(focused(await b.arrow("right"))).toBe("WEB-4")
    // Across columns the focus keeps its row.
    expect(focused(await b.press("h"))).toBe("WEB-3")
    expect(focused(await b.press("l", "l"))).toBeUndefined()
    // An empty column has no card to mark but is still where n creates.
    expect(rows(await b.frame())[1]).toMatch(/╭─ Review \(0\) ─+╮/)
  })

  test("Enter opens the detail with the rendered description and subtasks; Tab and space tick one off", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({
      title: "Ship the release",
      assigneeIds: [w.me],
      priority: "urgent",
      body: "## Steps\n\nSome **careful** work:\n\n- build\n- publish",
    })
    const kid = await w.addTask({ title: "Write notes", parentTaskId: parent.id })
    await w.addTask({ title: "Tag it", parentTaskId: parent.id, status: "complete" })
    const b = await board(w)
    const frame = await b.enter()
    expect(frame).toContain("╭─ WEB-1 ─")
    for (const text of [
      "Ship the release",
      "Status     ○ Todo",
      "Priority   !! Urgent",
      "Assignees  Alan Owner",
      "Description",
      "Some careful work:",
      "build",
      "Subtasks 1/2",
      " ○ WEB-2  Write notes",
      " ● WEB-3  Tag it",
    ]) {
      expect(frame).toContain(text)
    }
    expect(frame).not.toContain("**")
    expect(frame).toContain("esc back · ↑↓ scroll · tab select")

    expect(await b.press("TAB")).toContain("▌○ WEB-2  Write notes")
    expect(await b.press(" ")).toContain("Subtasks 2/2")
    expect((await w.getTask(kid.id)).status).toBe("complete")

    // Enter on a subtask opens it on top; Esc goes back, then closes.
    expect(await b.enter()).toContain("╭─ WEB-2 ─")
    expect(await b.escape()).toContain("╭─ WEB-1 ─")
    const closed = await b.escape()
    expect(closed).not.toContain("╭─ WEB-1 ─")
    expect(columnKeys(closed, "Todo")).toEqual(["WEB-1"])
  })

  test("a click focuses a card, a second click opens it", async () => {
    const w = await boardWorld(server)
    await threeTodos(w)
    const b = await board(w)
    // Row 5 is the second card's first line; column 10 is inside Todo.
    let frame = await b.click(10, 5)
    expect(columnLines(frame, "Todo")[2]).toBe("▌WEB-2 Two")
    frame = await b.click(10, 5)
    expect(frame).toContain("╭─ WEB-2 ─")
  })

  test("clicks on the board do nothing while something is open over it", async () => {
    const w = await boardWorld(server)
    await threeTodos(w)
    const b = await board(w)
    await b.press("x")
    await b.click(10, 5)
    await b.click(10, 5)
    expect(overlays(b)).toEqual(["confirm"])
    await b.press("n")
    await b.enter()
    await b.click(10, 5)
    const frame = await b.click(10, 5)
    expect(overlays(b)).toEqual(["detail"])
    expect(frame).toContain("╭─ WEB-3 ─")
    // Once it is closed, the board takes clicks again.
    await b.escape()
    expect(await b.click(10, 5)).not.toContain("╭─ WEB")
    expect(await b.click(10, 5)).toContain("╭─ WEB-2 ─")
  })

  test("`intesa board WEB-2` opens on that task", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "First", assigneeIds: [w.me] })
    await w.addTask({ title: "Second", assigneeIds: [w.me], status: "review" })
    const b = await board(w, { ref: "web-2" })
    const frame = await b.frame()
    expect(frame).toContain("╭─ WEB-2 ─")
    expect(frame).toContain("Status     ◉ Review")
    await b.escape()
    expect(columnLines(await b.frame(), "Review")[0]).toBe("▌WEB-2 Second")
  })

  test("on someone else's task, the board shows everyone's so the focus can be on it", async () => {
    const w = await boardWorld(server)
    const mei = await w.addPerson("Mei Chen")
    await w.addTask({ title: "Mine", assigneeIds: [w.me] })
    await w.addTask({ title: "Meis", assigneeIds: [mei.id] })
    const b = await board(w, { ref: "web-2" })
    expect(await b.frame()).toContain("╭─ WEB-2 ─")
    const frame = await b.escape()
    expect(rows(frame)[0]).toContain("filter: everyone")
    expect(columnLines(frame, "Todo")[0]).toBe("▌WEB-2 Meis")
  })

  test("q closes the detail pane, as it closes menus and help; K/J there say why they wait", async () => {
    const w = await boardWorld(server)
    await threeTodos(w)
    const b = await board(w)
    await b.enter()
    expect(rows(await b.press("J")).at(-1)).toBe(" Close the task (esc) to reorder it")
    const frame = await b.press("q")
    expect(frame).not.toContain("╭─ WEB-3 ─")
    expect(b.quit).toBe(false)
    await b.press("t")
    expect(rows(await b.press("J")).at(-1)).toBe(" Cards are reordered on the board (b)")
  })

  test("the detail pane scrolls a long description, and back at once from its end", async () => {
    const w = await boardWorld(server)
    const body = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join("\n\n")
    await w.addTask({ title: "Long", assigneeIds: [w.me], body })
    const b = await board(w)
    expect(await b.enter()).toMatch(/Line 1\b/)
    for (let i = 0; i < 300; i++) b.keys.pressKey("j")
    let frame = await b.frame()
    expect(frame).toContain("Line 60")
    expect(frame).toContain(" 100% ")
    frame = await b.press("k")
    expect(frame).not.toContain(" 100% ")
    // Page Up.
    frame = await b.press("\x1b[5~")
    expect(frame).not.toContain("Line 60")
  })
})

describe("board: moving cards", () => {
  test("Alt+→ moves a card to the next column; the server agrees and history shows it", async () => {
    const w = await boardWorld(server)
    const { three } = await threeTodos(w)
    const b = await board(w)
    let frame = await b.arrow("right", { meta: true })
    expect(columnKeys(frame, "In progress")).toEqual(["WEB-3"])
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-2", "WEB-1"])
    expect(columnLines(frame, "In progress")[0]).toBe("▌WEB-3 Three")
    expect((await w.getTask(three.id)).status).toBe("in_progress")

    // `>` is the alternate for terminals that keep Alt+arrows to themselves; `<` goes back.
    frame = await b.press(">")
    expect(columnKeys(frame, "Review")).toEqual(["WEB-3"])
    frame = await b.press("<")
    expect(columnKeys(frame, "In progress")).toEqual(["WEB-3"])
    expect((await w.getTask(three.id)).status).toBe("in_progress")

    frame = await b.enter()
    expect(frame).toContain("History")
    expect(frame).toMatch(/Alan Owner {2}Review → In progress/)
    expect(frame).toMatch(/Alan Owner {2}Todo → In progress/)
  })

  test("a move past the last column says so and changes nothing", async () => {
    const w = await boardWorld(server)
    const done = await w.addTask({ title: "Done", status: "complete", assigneeIds: [w.me] })
    const b = await board(w)
    await b.press("l", "l", "l")
    const frame = await b.arrow("right", { meta: true })
    expect(rows(frame).at(-1)).toContain("WEB-1 is already in Complete")
    expect((await w.getTask(done.id)).status).toBe("complete")
  })

  test("K/J and Alt+↑/↓ reorder within the column, and the order is saved", async () => {
    const w = await boardWorld(server)
    await threeTodos(w)
    const b = await board(w)
    expect(columnKeys(await b.press("J"), "Todo")).toEqual(["WEB-2", "WEB-3", "WEB-1"])
    expect(await w.column("todo")).toEqual(["WEB-2", "WEB-3", "WEB-1"])
    expect(columnKeys(await b.arrow("down", { meta: true }), "Todo")).toEqual([
      "WEB-2",
      "WEB-1",
      "WEB-3",
    ])
    expect(await w.column("todo")).toEqual(["WEB-2", "WEB-1", "WEB-3"])
    const frame = await b.press("K")
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-2", "WEB-3", "WEB-1"])
    expect(columnLines(frame, "Todo")[2]).toBe("▌WEB-3 Three")
    await b.arrow("up", { meta: true })
    expect(await w.column("todo")).toEqual(["WEB-3", "WEB-2", "WEB-1"])
    expect(rows(await b.press("K")).at(-1)).toContain("WEB-3 is already the first card in Todo")
  })

  test("with a filter on, K/J pass the cards it hides, as on the web", async () => {
    const w = await boardWorld(server)
    const mei = await w.addPerson("Mei Chen")
    const one = await w.addTask({ title: "One", assigneeIds: [w.me] })
    await w.addTask({ title: "Two", assigneeIds: [mei.id] })
    const three = await w.addTask({ title: "Three", assigneeIds: [w.me] })
    await w.patchTask(three.id, { placement: "last" })
    await w.patchTask(one.id, { placement: "first" })
    expect(await w.column("todo")).toEqual(["WEB-1", "WEB-2", "WEB-3"])
    const b = await board(w)
    expect(columnKeys(await b.frame(), "Todo")).toEqual(["WEB-1", "WEB-3"])
    expect(columnKeys(await b.press("J"), "Todo")).toEqual(["WEB-3", "WEB-1"])
    // Placed after WEB-3, past the hidden WEB-2: below it would not have moved on screen.
    expect(await w.column("todo")).toEqual(["WEB-2", "WEB-3", "WEB-1"])
  })

  test("a move the server rejects is rolled back with a toast", async () => {
    const w = await boardWorld(server)
    const { three } = await threeTodos(w)
    const b = await board(w)
    w.faults.failWrites = true
    const frame = await b.arrow("right", { meta: true })
    expect(rows(frame).at(-1)).toBe(" ✗ Could not save WEB-3.")
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-3", "WEB-2", "WEB-1"])
    expect(columnKeys(frame, "In progress")).toEqual([])
    expect((await w.getTask(three.id)).status).toBe("todo")
    // A failed reorder goes back too.
    expect(columnKeys(await b.press("J"), "Todo")).toEqual(["WEB-3", "WEB-2", "WEB-1"])
  })

  test("moving a task deleted meanwhile shows the server's reason and drops the card", async () => {
    const w = await boardWorld(server)
    const { three } = await threeTodos(w)
    const b = await board(w)
    await w.deleteTask(three.id)
    const frame = await b.arrow("right", { meta: true })
    expect(rows(frame).at(-1)).toBe(" ✗ Could not save WEB-3: Task not found")
    // The refresh after the failure shows the board as the server has it.
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-2", "WEB-1"])
    expect(columnKeys(frame, "In progress")).toEqual([])
  })

  test("moving a parent offers to update its subtasks, like the web dialog", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({ title: "Parent", assigneeIds: [w.me] })
    const todo = await w.addTask({ title: "Kid todo", parentTaskId: parent.id })
    const done = await w.addTask({ title: "Kid done", parentTaskId: parent.id, status: "complete" })
    const b = await board(w)

    let frame = await b.arrow("right", { meta: true })
    expect(frame).toContain("Update subtasks?")
    expect(frame).toContain("WEB-1 moved to In progress. Choose the state of its subtasks.")
    expect(frame).toMatch(/▌WEB-2 {2}Kid todo +○ Todo/)
    expect(frame).toMatch(/ WEB-3 {2}Kid done +● Complete/)
    // Esc leaves them as they are.
    frame = await b.escape()
    expect(frame).not.toContain("Update subtasks?")
    expect((await w.getTask(todo.id)).status).toBe("todo")

    frame = await b.press(">")
    expect(frame).toContain("WEB-1 moved to Review.")
    frame = await b.press("a")
    expect(frame).toMatch(/WEB-2 {2}Kid todo +◉ Review \*/)
    expect(frame).toContain("enter update 2 subtasks")
    frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(" Updated 2 subtasks")
    expect((await w.getTask(todo.id)).status).toBe("review")
    expect((await w.getTask(done.id)).status).toBe("review")
    expect(columnLines(frame, "Review")[1]).toBe("▌@alan ☐ 0/2")

    // One subtask by hand: down, then the status left of its current one.
    frame = await b.press("<")
    frame = await b.press("j", "h")
    expect(frame).toMatch(/WEB-3 {2}Kid done +◐ In progress \*/)
    expect(frame).toContain("enter update 1 subtask")
    await b.enter()
    expect((await w.getTask(done.id)).status).toBe("in_progress")
    expect((await w.getTask(todo.id)).status).toBe("review")
  })
})

describe("board: keeping up with the server", () => {
  const list = (w: BoardWorld) => `/api/projects/${w.project.id}/tasks`

  test("a refresh answered after a move does not undo it", async () => {
    const w = await boardWorld(server)
    await threeTodos(w)
    const b = await board(w)
    const slow = w.hold("GET", list(w))
    b.keys.pressKey("r")
    await slow.reached
    // The move is saved and the board refreshed while the first answer is on its way.
    const before = w.answered.length
    b.keys.pressArrow("right", { meta: true })
    await until(() => w.answered.slice(before).includes(`GET ${list(w)}`))
    slow.release()
    const frame = await b.frame()
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-2", "WEB-1"])
    expect(columnLines(frame, "In progress")[0]).toBe("▌WEB-3 Three")
  })

  test("a refresh answered after a delete does not bring the card back", async () => {
    const w = await boardWorld(server)
    await threeTodos(w)
    const b = await board(w)
    const slow = w.hold("GET", list(w))
    b.keys.pressKey("r")
    await slow.reached
    const before = w.answered.length
    b.keys.pressKey("x")
    b.keys.pressKey("y")
    await until(() => w.answered.slice(before).includes(`GET ${list(w)}`))
    slow.release()
    expect(columnKeys(await b.frame(), "Todo")).toEqual(["WEB-2", "WEB-1"])
  })

  test("a task loaded before a subtask was ticked off does not untick it", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({ title: "Parent", assigneeIds: [w.me] })
    await w.addTask({ title: "Kid", parentTaskId: parent.id })
    const b = await board(w)
    await b.enter()
    await b.press("TAB")
    const slow = w.hold("GET", `/api/tasks/${parent.id}`)
    b.keys.pressKey("r")
    await slow.reached
    const before = w.answered.length
    b.keys.pressKey(" ")
    await until(() => w.answered.slice(before).includes(`GET /api/tasks/${parent.id}`))
    slow.release()
    const frame = await b.frame()
    expect(frame).toContain("Subtasks 1/1")
    expect(frame).toContain("▌● WEB-2  Kid")
  })

  test("the board polls for changes, but not while an input or menu is open", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "First", assigneeIds: [w.me] })
    const b = await board(w, { pollMs: 20 })
    await w.addTask({ title: "Second", assigneeIds: [w.me] })
    await b.waitFor((frame) => columnKeys(frame, "Todo").includes("WEB-2"))
    await b.press("/")
    await w.addTask({ title: "Third", assigneeIds: [w.me] })
    await Bun.sleep(150)
    expect(columnKeys(await b.frame(), "Todo")).toEqual(["WEB-2", "WEB-1"])
    await b.escape()
    await b.waitFor((frame) => columnKeys(frame, "Todo").includes("WEB-3"))
  })
})

describe("board: filters and views", () => {
  test("search filters with the shared syntax; Esc clears it", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "Fix login redirect", assigneeIds: [w.me], priority: "high" })
    await w.addTask({ title: "Tag colors", assigneeIds: [w.me] })
    await w.addTask({ title: "Login 2FA", assigneeIds: [w.me], status: "review" })
    const b = await board(w)
    let frame = await b.press("/")
    expect(rows(frame).at(-1)).toBe(" Search: ▏")
    frame = await b.type("login")
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-1"])
    expect(columnKeys(frame, "Review")).toEqual(["WEB-3"])
    frame = await b.enter()
    expect(rows(frame)[0]).toContain("search: login")
    frame = await b.press("f")
    for (let i = 0; i < 5; i++) await b.press("BACKSPACE")
    frame = await b.type("priority:high")
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-1"])
    expect(columnKeys(frame, "Review")).toEqual([])
    await b.enter()
    frame = await b.escape()
    expect(rows(frame)[0]).not.toContain("search:")
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-2", "WEB-1"])
  })

  test("Esc in a new search puts back the one before", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "Fix login redirect", assigneeIds: [w.me] })
    await w.addTask({ title: "Tag colors", assigneeIds: [w.me] })
    const b = await board(w)
    await b.press("/")
    await b.type("login")
    await b.enter()
    await b.press("/")
    expect(columnKeys(await b.type(" colors"), "Todo")).toEqual([])
    const frame = await b.escape()
    expect(rows(frame)[0]).toContain("search: login")
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-1"])
  })

  test("P and W switch project and workspace through pickers that filter as you type", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "Web card", assigneeIds: [w.me] })
    const api = await w.addProject("Api", "API")
    await w.addTask({ title: "Api card", assigneeIds: [w.me] }, api.id)
    const b = await board(w)
    let frame = await b.press("P")
    expect(frame).toContain(`╭─ Projects in ${w.workspace.slug} ─`)
    expect(frame).toContain("WEB  Web")
    frame = await b.type("api")
    expect(frame).toContain("▌API  Api")
    expect(frame).not.toContain("WEB  Web")
    frame = await b.enter()
    expect(rows(frame)[0]).toStartWith(` ${w.workspace.slug} / API · Board`)
    expect(columnLines(frame, "Todo")[0]).toBe("▌API-1 Api card")

    const other = await w.addWorkspace(`${w.workspace.slug}-two`)
    const ops = await w.addProject("Ops", "OPS", other.id)
    await w.addTask({ title: "Ops card", assigneeIds: [w.me] }, ops.id)
    frame = await b.press("W")
    expect(frame).toContain("╭─ Workspaces ─")
    await b.type("two")
    frame = await b.enter()
    expect(frame).toContain(`╭─ Projects in ${other.slug} ─`)
    frame = await b.enter()
    expect(rows(frame)[0]).toStartWith(` ${other.slug} / OPS · Board`)
    expect(columnLines(frame, "Todo")[0]).toBe("▌OPS-1 Ops card")
  })

  test("Shift+→ and Shift+← step through me, each member, unassigned and everyone", async () => {
    const w = await boardWorld(server)
    const mei = await w.addPerson("Mei Chen")
    await w.addTask({ title: "Mine", assigneeIds: [w.me] })
    await w.addTask({ title: "Meis", assigneeIds: [mei.id] })
    await w.addTask({ title: "Nobodys" })
    const b = await board(w)
    const view = async (frame: string) => ({
      filter: /filter: (\S+)/.exec(rows(frame)[0] ?? "")?.[1],
      todo: columnKeys(frame, "Todo"),
    })
    expect(await view(await b.frame())).toEqual({ filter: "@me", todo: ["WEB-1"] })
    expect(await view(await b.arrow("right", { shift: true }))).toEqual({
      filter: "@mei",
      todo: ["WEB-2"],
    })
    expect(await view(await b.arrow("right", { shift: true }))).toEqual({
      filter: "unassigned",
      todo: ["WEB-3"],
    })
    expect(await view(await b.arrow("right", { shift: true }))).toEqual({
      filter: "everyone",
      todo: ["WEB-3", "WEB-2", "WEB-1"],
    })
    expect(await view(await b.arrow("right", { shift: true }))).toEqual({
      filter: "@me",
      todo: ["WEB-1"],
    })
    expect((await view(await b.arrow("left", { shift: true }))).filter).toBe("everyone")
  })

  test("t shows the table, sortable like the web table; b goes back", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "Bravo", assigneeIds: [w.me], priority: "low" })
    await w.addTask({ title: "Alpha", assigneeIds: [w.me], status: "review" })
    await w.addTask({ title: "Charlie", assigneeIds: [w.me], priority: "urgent" })
    const b = await board(w)
    const order = (frame: string) =>
      rows(frame)
        .slice(2)
        .flatMap((r) => /WEB-\d+/.exec(r)?.[0] ?? [])
    let frame = await b.press("t")
    expect(rows(frame)[0]).toContain("/ WEB · Table")
    expect(rows(frame)[1]).toMatch(/^ Task +Status +Priority +Assignees +Tags +Due$/)
    // Unsorted, the rows are in board order.
    expect(order(frame)).toEqual(["WEB-3", "WEB-2", "WEB-1"])
    expect(rows(frame)[2]).toMatch(/^▌WEB-3 +Charlie +○ Todo +Urgent +@alan/)
    frame = await b.press("3")
    expect(rows(frame)[1]).toContain("Priority ↑")
    expect(order(frame)).toEqual(["WEB-3", "WEB-1", "WEB-2"])
    // Descending, with the task that has no priority still last.
    frame = await b.press("3")
    expect(order(frame)).toEqual(["WEB-1", "WEB-3", "WEB-2"])
    // The focus stays on its task: Charlie, now second, is the one Enter opens.
    expect(rows(frame)[3]).toStartWith("▌WEB-3")
    expect(await b.enter()).toContain("╭─ WEB-3 ─")
    await b.escape()
    frame = await b.press("1")
    expect(order(frame)).toEqual(["WEB-2", "WEB-1", "WEB-3"])
    frame = await b.press("2")
    expect(order(frame)).toEqual(["WEB-3", "WEB-1", "WEB-2"])
    frame = await b.press("b")
    expect(rows(frame)[0]).toContain("/ WEB · Board")
    expect(columnLines(frame, "Todo")[0]).toBe("▌WEB-3 Charlie")
  })

  test("the Backlog rail opens with Enter and folds with [", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "Someday", status: "backlog", assigneeIds: [w.me] })
    await w.addTask({ title: "Now", assigneeIds: [w.me] })
    const b = await board(w)
    await b.press("h")
    let frame = await b.enter()
    expect(rows(frame)[1]).toMatch(/^╭─ Backlog \(1\) ─+╮╭─ Todo \(1\)/)
    expect(columnLines(frame, "Backlog")[0]).toBe("▌WEB-1 Someday")
    frame = await b.press("[")
    expect(rows(frame)[1]).toStartWith("╭─╮╭─ Todo (1)")
    // A card moved into the folded Backlog opens it, so the focus can follow.
    await b.press("l")
    frame = await b.arrow("left", { meta: true })
    expect(columnKeys(frame, "Backlog")).toEqual(["WEB-2", "WEB-1"])
    expect(columnLines(frame, "Backlog")[0]).toBe("▌WEB-2 Now")
  })
})

describe("board: task actions", () => {
  test("n creates a task in the focused column, assigned like the web composer", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "Existing", status: "review", assigneeIds: [w.me] })
    const b = await board(w)
    await b.press("l", "l")
    let frame = await b.press("n")
    expect(rows(frame).at(-1)).toBe(" New task in Review: ▏")
    // An empty title does nothing.
    frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(" New task in Review: ▏")
    await b.type("Write the docs")
    frame = await b.enter()
    expect(columnLines(frame, "Review").slice(0, 2)).toEqual(["▌WEB-2 Write the docs", "▌@alan"])
    expect(rows(frame).at(-1)).toBe(" Created WEB-2")
    const created = (await w.projectTasks()).find((t) => t.key === "WEB-2")
    expect(created).toMatchObject({ status: "review", title: "Write the docs" })
    expect(created.assignees.map((a: { id: string }) => a.id)).toEqual([w.me])
  })

  test("p, d and a change priority, due date and assignment; the menu offers the same", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Plan", assigneeIds: [w.me] })
    const b = await board(w)

    let frame = await b.press("p")
    expect(frame).toContain("Priority of WEB-1")
    expect(frame).toMatch(/▌n {2}No priority {2}●/)
    await b.press("u")
    expect((await w.getTask(task.id)).priority).toBe("urgent")
    expect(columnLines(await b.frame(), "Todo")[1]).toBe("▌!! @alan")

    frame = await b.press("d", "p")
    expect(rows(frame).at(-1)).toBe(" Due date of WEB-1 (YYYY-MM-DD): ▏")
    await b.type("2030-02-30")
    frame = await b.enter()
    expect(rows(frame).at(-1)).toContain("Use a date like")
    for (let i = 0; i < 2; i++) await b.press("BACKSPACE")
    await b.type("28")
    await b.enter()
    expect((await w.getTask(task.id)).dueAt).toBe("2030-02-28")

    frame = await b.press("m")
    expect(frame).toContain("Unassign me")
    await b.press("a")
    expect((await w.getTask(task.id)).assignees).toEqual([])
    // Filtered to me, the card has left the board.
    expect(columnKeys(await b.frame(), "Todo")).toEqual([])
  })

  test("x deletes after confirming", async () => {
    const w = await boardWorld(server)
    const { three } = await threeTodos(w)
    await w.addTask({ title: "Kid", parentTaskId: three.id })
    const b = await board(w)
    let frame = await b.press("x")
    expect(frame).toContain("Delete WEB-3 (Three)? Its 1 subtask will be deleted too.")
    frame = await b.press("n")
    expect(frame).not.toContain("Delete WEB-3")
    expect(await w.getTask(three.id)).toBeDefined()
    await b.press("x")
    frame = await b.press("y")
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-2", "WEB-1"])
    expect(rows(frame).at(-1)).toBe(" Deleted WEB-3")
    expect(await w.getTask(three.id)).toBeUndefined()
  })

  test("only a plain y confirms a delete", async () => {
    const w = await boardWorld(server)
    const { three } = await threeTodos(w)
    const b = await board(w)
    await b.press("x")
    b.keys.pressKey("y", { ctrl: true })
    b.keys.pressKey("y", { meta: true })
    expect(await b.frame()).toContain("Delete WEB-3")
    expect(await w.getTask(three.id)).toBeDefined()
  })

  test("a task the server will not create is not added, and says so", async () => {
    const w = await boardWorld(server)
    await w.addTask({ title: "Existing", assigneeIds: [w.me] })
    const b = await board(w)
    w.faults.failWrites = true
    await b.press("n")
    await b.type("Doomed")
    const frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(" ✗ Could not create the task.")
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-1"])
    expect(await w.column("todo")).toEqual(["WEB-1"])
  })

  test("a delete the server refuses puts the card back where it was", async () => {
    const w = await boardWorld(server)
    const { two } = await threeTodos(w)
    const b = await board(w)
    await b.press("j")
    w.faults.failWrites = true
    await b.press("x")
    const frame = await b.press("y")
    expect(rows(frame).at(-1)).toBe(" ✗ Could not delete WEB-2.")
    expect(columnKeys(frame, "Todo")).toEqual(["WEB-3", "WEB-2", "WEB-1"])
    expect(await w.getTask(two.id)).toBeDefined()
  })

  test("e edits the title and description in the editor", async () => {
    const dir = tempDir("intesa-board-editor-")
    const script = join(dir, "editor.js")
    await Bun.write(
      script,
      `const path = process.argv[2]
const text = await Bun.file(path).text()
await Bun.write(path, text.replace("title: Draft", "title: Final title").replace("old notes", "new notes"))`,
    )
    const w = await boardWorld(server, { editor: `"${process.execPath}" "${script}"` })
    const task = await w.addTask({ title: "Draft", assigneeIds: [w.me], body: "Some old notes" })
    const b = await board(w)
    const frame = await b.press("e")
    expect(columnLines(frame, "Todo")[0]).toBe("▌WEB-1 Final title")
    expect(await w.getTask(task.id)).toMatchObject({ title: "Final title", body: "Some new notes" })
  })

  test("Enter on a Markdown artifact edits it in the editor and saves it back", async () => {
    const w = await boardWorld(server, { editor: await replacingEditor("old", "new") })
    const task = await w.addTask({ title: "Docs", assigneeIds: [w.me] })
    const notes = await w.addArtifact(task.id, "notes.md", "# Notes\n\nold text\n")
    const b = await board(w)
    expect(await b.enter()).toContain("Artifacts (1)")
    expect(await b.press("TAB")).toContain("▌notes.md")
    const frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(" Saved notes.md")
    expect(await w.artifactText(task.id, notes.id)).toBe("# Notes\n\nnew text\n")
  })

  test("an artifact the server will not save says so, without the server's own words", async () => {
    const w = await boardWorld(server, { editor: await replacingEditor("old", "new") })
    const task = await w.addTask({ title: "Docs", assigneeIds: [w.me] })
    const notes = await w.addArtifact(task.id, "notes.md", "old text\n")
    const b = await board(w)
    await b.enter()
    await b.press("TAB")
    w.faults.failWrites = true
    expect(rows(await b.enter()).at(-1)).toBe(" ✗ Could not save notes.md.")
    expect(await w.artifactText(task.id, notes.id)).toBe("old text\n")
  })

  test("other artifacts open in the browser", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Docs", assigneeIds: [w.me] })
    const page = await w.addArtifact(task.id, "page.html", "<p>Hello</p>\n")
    const b = await board(w)
    await b.enter()
    await b.press("TAB")
    expect(rows(await b.enter()).at(-1)).toBe(" Opening page.html in your browser")
    await until(() => w.opened().length > 0)
    expect(w.opened()).toEqual([`${server.url}/api/tasks/${task.id}/artifacts/${page.id}`])
  })

  test("an editor that fails saves nothing and says why", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Draft", assigneeIds: [w.me] })
    const b = await board(w)
    const frame = await b.press("e")
    expect(rows(frame).at(-1)).toContain("✗ Could not edit WEB-1:")
    expect((await w.getTask(task.id)).title).toBe("Draft")
  })
})

describe("board: subtasks and artifacts in the open task", () => {
  const subtasksOf = async (w: BoardWorld, id: string) =>
    ((await w.getTask(id)).subtasks as { key: string; title: string; status: string }[]).map(
      (s) => [s.key, s.title, s.status],
    )

  test("n adds a subtask at once, selects it, and saves it under the open task", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({ title: "Parent", assigneeIds: [w.me] })
    const b = await board(w)
    await b.enter()
    let frame = await b.press("n")
    expect(rows(frame).at(-1)).toBe(" New subtask of WEB-1: ▏")
    await b.type("Write tests")
    // Shown before the server has answered.
    const slow = w.hold("POST", `/api/projects/${w.project.id}/tasks`)
    b.keys.pressEnter()
    await slow.reached
    const shown = b.store.state.details[parent.id]?.task?.subtasks.map((s) => s.title)
    expect(shown).toEqual(["Write tests"])
    slow.release()
    frame = await b.frame()
    expect(frame).toContain("Subtasks 0/1")
    expect(frame).toContain("▌○ WEB-2  Write tests")
    expect(rows(frame).at(-1)).toBe(" Created WEB-2")
    expect(await subtasksOf(w, parent.id)).toEqual([["WEB-2", "Write tests", "todo"]])
    // The card counts it too.
    expect(columnLines(await b.escape(), "Todo")[1]).toBe("▌@alan ☐ 0/1")
  })

  test("space, Enter and x leave a subtask alone while it is being created", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({ title: "Parent", assigneeIds: [w.me] })
    const b = await board(w)
    await b.enter()
    await b.press("n")
    await b.type("Pending")
    const slow = w.hold("POST", `/api/projects/${w.project.id}/tasks`)
    b.keys.pressEnter()
    await slow.reached
    const sent = w.answered.length
    const keys: [string, () => void][] = [
      ["space", () => b.keys.pressKey(" ")],
      ["Enter", () => b.keys.pressEnter()],
      ["x", () => b.keys.pressKey("x")],
    ]
    for (const [name, press] of keys) {
      b.store.toast("")
      press()
      expect(b.store.state.toast?.text, name).toBe('"Pending" is still being created')
      expect(overlays(b), name).toEqual(["detail"])
    }
    slow.release()
    const frame = await b.frame()
    expect(rows(frame).at(-1)).toBe(" Created WEB-2")
    expect(w.answered.slice(sent).filter((r) => !r.startsWith("GET"))).toEqual([
      `POST /api/projects/${w.project.id}/tasks`,
    ])
    expect(await subtasksOf(w, parent.id)).toEqual([["WEB-2", "Pending", "todo"]])
  })

  test("a subtask the server will not create is taken back, and says so", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({ title: "Parent", assigneeIds: [w.me] })
    await w.addTask({ title: "Kid", parentTaskId: parent.id })
    const b = await board(w)
    await b.enter()
    w.faults.failWrites = true
    await b.press("n")
    await b.type("Doomed")
    const frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(" ✗ Could not create the subtask.")
    expect(frame).not.toContain("Doomed")
    expect(frame).toContain("Subtasks 0/1")
    expect(await subtasksOf(w, parent.id)).toEqual([["WEB-2", "Kid", "todo"]])
  })

  test("a subtask cannot have subtasks of its own", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({ title: "Parent", assigneeIds: [w.me] })
    await w.addTask({ title: "Kid", parentTaskId: parent.id })
    const b = await board(w)
    await b.enter()
    await b.press("TAB")
    await b.enter()
    const frame = await b.press("n")
    expect(rows(frame).at(-1)).toBe(" WEB-2 is a subtask; subtasks cannot have their own")
    expect(overlays(b)).toEqual(["detail", "detail"])
  })

  test("x deletes the selected subtask after confirming; with none selected, the task", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({ title: "Parent", assigneeIds: [w.me] })
    const one = await w.addTask({ title: "Kid one", parentTaskId: parent.id })
    await w.addTask({ title: "Kid two", parentTaskId: parent.id })
    const b = await board(w)
    await b.enter()
    expect(await b.press("x")).toContain(
      "Delete WEB-1 (Parent)? Its 2 subtasks will be deleted too.",
    )
    await b.press("n")
    await b.press("TAB")
    expect(await b.press("x")).toContain("Delete WEB-2 (Kid one)?")
    await b.press("n")
    expect(await w.getTask(one.id)).toBeDefined()
    await b.press("x")
    const frame = await b.press("y")
    expect(rows(frame).at(-1)).toBe(" Deleted WEB-2")
    expect(frame).toContain("╭─ WEB-1 ─")
    expect(frame).toContain("Subtasks 0/1")
    expect(frame).not.toContain("Kid one")
    expect(await w.getTask(one.id)).toBeUndefined()
    expect(await subtasksOf(w, parent.id)).toEqual([["WEB-3", "Kid two", "todo"]])
    // Nothing is selected after it, so the next x plainly means the open task.
    expect(frame).toContain(" ○ WEB-3  Kid two")
    expect(frame).not.toContain("▌○ WEB-3")
    expect(await b.press("x")).toContain("Delete WEB-1 (Parent)?")
  })

  test("a subtask delete the server refuses puts it back", async () => {
    const w = await boardWorld(server)
    const parent = await w.addTask({ title: "Parent", assigneeIds: [w.me] })
    await w.addTask({ title: "Kid one", parentTaskId: parent.id })
    await w.addTask({ title: "Kid two", parentTaskId: parent.id })
    const b = await board(w)
    await b.enter()
    await b.press("TAB")
    w.faults.failWrites = true
    await b.press("x")
    const frame = await b.press("y")
    expect(rows(frame).at(-1)).toBe(" ✗ Could not delete WEB-2.")
    expect(frame).toContain("Subtasks 0/2")
    expect(frame.indexOf("WEB-2  Kid one")).toBeLessThan(frame.indexOf("WEB-3  Kid two"))
  })

  test("e on a subtask opened from its parent edits the subtask", async () => {
    const w = await boardWorld(server, {
      editor: await replacingEditor("title: Kid", "title: Grown"),
    })
    const parent = await w.addTask({ title: "Parent", assigneeIds: [w.me] })
    const kid = await w.addTask({ title: "Kid", parentTaskId: parent.id })
    const b = await board(w)
    await b.enter()
    await b.press("TAB")
    expect(await b.enter()).toContain("╭─ WEB-2 ─")
    await b.press("e")
    expect((await w.getTask(kid.id)).title).toBe("Grown")
    expect((await w.getTask(parent.id)).title).toBe("Parent")
    expect(await b.escape()).toContain("○ WEB-2  Grown")
  })

  // A directory of files to upload, with a space in its name.
  async function files(names: Record<string, string>) {
    const dir = join(tempDir("intesa-board-upload-"), "my files")
    for (const [name, content] of Object.entries(names)) await Bun.write(join(dir, name), content)
    return dir
  }

  test("u uploads files, quoted or relative to the working directory, into the list", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Docs", assigneeIds: [w.me] })
    const dir = await files({ "spec.html": "<p>Spec</p>\n" })
    await Bun.write(join(w.ctx.cwd, "notes.md"), "# Notes\n")
    const b = await board(w)
    await b.enter()
    let frame = await b.press("u")
    expect(rows(frame).at(-1)).toBe(" Upload to WEB-1: ▏")
    await b.type(`notes.md "${join(dir, "spec.html")}"`)
    frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(" Uploaded 2 artifacts")
    expect(frame).toContain("Artifacts (2)")
    expect(frame).toContain(" notes.md  text/markdown")
    expect(frame).toContain(" spec.html  text/html")
    const saved = await w.artifacts(task.id)
    expect(saved.map((a) => a.name).sort()).toEqual(["notes.md", "spec.html"])
  })

  test("a path with spaces works unquoted when it names one file", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Docs", assigneeIds: [w.me] })
    const dir = await files({ "notes.md": "# Notes\n" })
    const b = await board(w)
    await b.enter()
    await b.press("u")
    await b.type(join(dir, "notes.md"))
    expect(rows(await b.enter()).at(-1)).toBe(" Uploaded notes.md")
    expect((await w.artifacts(task.id)).map((a) => a.name)).toEqual(["notes.md"])
  })

  test("a file the server would refuse is refused here, before anything is sent", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Docs", assigneeIds: [w.me] })
    await Bun.write(join(w.ctx.cwd, "notes.md"), "# Notes\n")
    await Bun.write(join(w.ctx.cwd, "notes.txt"), "plain\n")
    const b = await board(w)
    await b.enter()
    const before = w.answered.length
    await b.press("u")
    await b.type("notes.md notes.txt")
    let frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(
      " Upload to WEB-1: notes.md notes.txt▏  notes.txt: Only HTML, PDF, Markdown, Word and OpenDocument files are allowed.",
    )
    for (let i = 0; i < 9; i++) await b.press("BACKSPACE")
    await b.type("nope.md")
    frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(" Upload to WEB-1: notes.md nope.md▏  nope.md: no such file")
    expect(w.answered.slice(before).filter((r) => !r.startsWith("GET"))).toEqual([])
    expect(await w.artifacts(task.id)).toEqual([])
  })

  test("an upload the server refuses says so and leaves the list as it was", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Docs", assigneeIds: [w.me] })
    await w.addArtifact(task.id, "old.md", "old\n")
    await Bun.write(join(w.ctx.cwd, "notes.md"), "# Notes\n")
    const b = await board(w)
    await b.enter()
    w.faults.failWrites = true
    await b.press("u")
    await b.type("notes.md")
    const frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(" ✗ Could not upload notes.md.")
    expect(frame).toContain("Artifacts (1)")
    expect(frame).not.toContain("notes.md  ")
    expect((await w.artifacts(task.id)).map((a) => a.name)).toEqual(["old.md"])
  })

  test("when a later file fails, the ones before it stay uploaded", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Docs", assigneeIds: [w.me] })
    await Bun.write(join(w.ctx.cwd, "notes.md"), "# Notes\n")
    // Passes the checks made here; the server finds it is no PDF.
    await Bun.write(join(w.ctx.cwd, "fake.pdf"), "not a PDF\n")
    const b = await board(w)
    await b.enter()
    await b.press("u")
    await b.type("notes.md fake.pdf")
    const frame = await b.enter()
    expect(rows(frame).at(-1)).toBe(
      " ✗ Could not upload fake.pdf: The file content does not match its format.",
    )
    expect(frame).toContain("Artifacts (1)")
    expect(frame).toContain(" notes.md  text/markdown")
    expect((await w.artifacts(task.id)).map((a) => a.name)).toEqual(["notes.md"])
  })

  test("quitting during an upload waits for it, however long it takes", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Docs", assigneeIds: [w.me] })
    await Bun.write(join(w.ctx.cwd, "notes.md"), "# Notes\n")
    const b = await board(w, { saveWaitMs: 20 })
    await b.enter()
    await b.press("u")
    await b.type("notes.md")
    const slow = w.hold("POST", `/api/tasks/${task.id}/artifacts`)
    b.keys.pressEnter()
    await slow.reached
    let finished = false
    void b.app.done.then(() => {
      finished = true
    })
    b.keys.pressCtrlC()
    await Bun.sleep(200)
    expect(finished).toBe(false)
    slow.release()
    expect(await b.app.done).toEqual([])
    expect((await w.artifacts(task.id)).map((a) => a.name)).toEqual(["notes.md"])
  })
})

describe("board: help and quitting", () => {
  test("? lists the keys; Esc closes it", async () => {
    const w = await boardWorld(server)
    const b = await board(w)
    let frame = await b.press("?")
    expect(frame).toContain("╭─ Keys ─")
    expect(frame).toContain("alt+← → / < >")
    expect(frame).toContain("Move the card to the previous or next column")
    expect(frame).toContain("Switch assignee filter")
    expect(frame).toContain("Refresh (also every 30 s, and after each change)")
    expect(frame).toContain("Open task: tick the selected subtask off, or back to Todo")
    frame = await b.escape()
    expect(frame).not.toContain("╭─ Keys ─")
  })

  test("q and Ctrl+C quit", async () => {
    const w = await boardWorld(server)
    const first = await board(w)
    await first.press("q")
    expect(await first.app.done).toEqual([])
    const second = await board(w)
    await second.press("j")
    expect(second.quit).toBe(false)
    await second.ctrlC()
    expect(await second.app.done).toEqual([])
  })

  test("Ctrl+C quits from an open input too", async () => {
    const w = await boardWorld(server)
    const b = await board(w)
    await b.press("/")
    await b.type("abc")
    await b.ctrlC()
    expect(await b.app.done).toEqual([])
  })

  test("q types into an open input instead of quitting", async () => {
    const w = await boardWorld(server)
    const b = await board(w)
    await b.press("/")
    const frame = await b.press("q")
    expect(rows(frame).at(-1)).toBe(" Search: q▏")
    expect(b.quit).toBe(false)
  })

  test("quitting waits for a change being saved and hands back what failed", async () => {
    const w = await boardWorld(server)
    const { three } = await threeTodos(w)
    const b = await board(w)
    w.faults.failWrites = true
    b.keys.pressArrow("right", { meta: true })
    b.keys.pressKey("q")
    const lost = await b.app.done
    expect(lost.map((l) => l.text)).toEqual(["Could not save WEB-3."])
    expect((await w.getTask(three.id)).status).toBe("todo")
  })

  test("quitting gives up on a change that takes too long to save, and says so", async () => {
    const w = await boardWorld(server)
    const { three } = await threeTodos(w)
    const b = await board(w, { saveWaitMs: 20 })
    const slow = w.hold("PATCH", `/api/tasks/${three.id}`)
    b.keys.pressArrow("right", { meta: true })
    await slow.reached
    b.keys.pressKey("q")
    const lost = await b.app.done
    slow.release()
    expect(lost.map((l) => l.text)).toEqual([
      "The board closed while changes were still being saved; they may be lost.",
    ])
  })

  test("the terminal is given back even when the board fails to start", async () => {
    const t = await createTestRenderer({ width: 80, height: 24 })
    const broken = () => {
      throw new Error("broken")
    }
    await expect(session(t.renderer, broken)).rejects.toThrow("broken")
    expect(t.renderer.isDestroyed).toBe(true)
  })
})
