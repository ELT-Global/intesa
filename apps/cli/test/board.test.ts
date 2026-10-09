import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type Board,
  type BoardWorld,
  boardWorld,
  columnKeys,
  columnLines,
  openBoard,
  removeBoardDirs,
  rows,
} from "./board-world"
import { startServer, type TestServer } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeBoardDirs()
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

  test("e edits the title and description in the editor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "intesa-board-editor-"))
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

  test("an editor that fails saves nothing and says why", async () => {
    const w = await boardWorld(server)
    const task = await w.addTask({ title: "Draft", assigneeIds: [w.me] })
    const b = await board(w)
    const frame = await b.press("e")
    expect(rows(frame).at(-1)).toContain("✗ Could not edit WEB-1:")
    expect((await w.getTask(task.id)).title).toBe("Draft")
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
    frame = await b.escape()
    expect(frame).not.toContain("╭─ Keys ─")
  })

  test("q and Ctrl+C quit", async () => {
    const w = await boardWorld(server)
    const first = await board(w)
    await first.press("q")
    expect(first.quit).toBe(true)
    const second = await board(w)
    await second.press("j")
    expect(second.quit).toBe(false)
    await second.ctrlC()
    expect(second.quit).toBe(true)
  })

  test("q types into an open input instead of quitting", async () => {
    const w = await boardWorld(server)
    const b = await board(w)
    await b.press("/")
    const frame = await b.press("q")
    expect(rows(frame).at(-1)).toBe(" Search: q▏")
    expect(b.quit).toBe(false)
  })
})
