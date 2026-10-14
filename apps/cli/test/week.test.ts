import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { shiftWeek, weekBounds, weekOf } from "@intesa/task-query"
import { removeSandboxes, sandbox, startServer, type TestServer, world } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

// The week is local time. `bun test` runs in UTC, so the CLI is told to as well.
const env = { TZ: "UTC" }
const thisWeek = () => weekOf(new Date())

describe("intesa week", () => {
  test("--json lists each person with their tasks and links", async () => {
    const w = await world(server)
    const mine = await w.addTask({ title: "Fix login redirect", assigneeIds: [w.me] })
    await w.addTask({ title: "Unassigned" })
    const grace = await w.addPerson("Grace Hopper")

    const r = await w.box.run(["week", "--json"], { env })
    expect(r.exitCode, r.stderr).toBe(0)
    const log = r.json()
    const { from, to } = weekBounds(thisWeek())
    expect(log).toMatchObject({ week: thisWeek(), from, to })
    expect(log.people.map((p: { user: { name: string } }) => p.user.name)).toEqual([
      "Alan Owner",
      "Grace Hopper",
    ])
    expect(log.people[0].tasks).toEqual([
      expect.objectContaining({
        key: mine.key,
        title: "Fix login redirect",
        carriedOver: false,
        project: expect.objectContaining({ id: w.project.id }),
        url: `${server.url}/w/${w.workspace.slug}/projects/${w.project.id}?task=${mine.id}`,
      }),
    ])
    expect(log.people.find((p: { user: { id: string } }) => p.user.id === grace.id).tasks).toEqual(
      [],
    )

    const narrowed = await w.box.run(["week", "--json", "--fields", "week,from"], { env })
    expect(Object.keys(narrowed.json())).toEqual(["week", "from"])
  })

  test("piped, prints the week as Markdown with linked task keys", async () => {
    const w = await world(server)
    const mine = await w.addTask({ title: "Fix [login] redirect", assigneeIds: [w.me] })
    await w.addPerson("Grace Hopper")

    const r = await w.box.run(["week"], { env })
    expect(r.exitCode, r.stderr).toBe(0)
    const link = `${server.url}/w/${w.workspace.slug}/projects/${w.project.id}?task=${mine.id}`
    expect(r.stdout).toStartWith("# Weekly log · ")
    expect(r.stdout).toContain("Acme · 1 pending")
    expect(r.stdout).toContain("## Alan Owner")
    expect(r.stdout).toContain(`- [ ] [${mine.key}](${link}) Fix \\[login\\] redirect — `)
    expect(r.stdout).toContain("**Nothing this week:** Grace Hopper")
    expect(r.stdout).not.toContain("\u001b[")

    const raw = await w.box.run(["week", "--raw"], { env })
    expect(raw.stdout).toBe(r.stdout)
  })

  test("--format prints the simple Markdown or the HTML, even on a terminal", async () => {
    const w = await world(server)
    const mine = await w.addTask({ title: "Fix login", assigneeIds: [w.me] })
    const tty = { ...env, INTESA_FORCE_TTY: "100", INTESA_PAGER: "cat" }

    const simple = await w.box.run(["week", "--format", "simple"], { env: tty })
    expect(simple.exitCode, simple.stderr).toBe(0)
    expect(simple.stdout).toStartWith("*Weekly log · ")
    expect(simple.stdout).toContain(
      `*Alan Owner* · 1 pending\n\n_Pending_\n- ${mine.key} Fix login — `,
    )
    expect(simple.stdout).not.toContain("](")

    const html = await w.box.run(["week", "--format", "html"], { env: tty })
    expect(html.exitCode, html.stderr).toBe(0)
    expect(html.stdout).toStartWith("<h2>Weekly log · ")
    expect(html.stdout).toContain(`?task=${mine.id}">${mine.key}</a> Fix login`)

    const bad = await w.box.run(["week", "--format", "pdf"], { env })
    expect(bad.exitCode).toBe(2)
  })

  test("takes this, last, next or a day in the week", async () => {
    const w = await world(server)
    const run = async (...args: string[]) => {
      const r = await w.box.run(["week", ...args, "--json", "--fields", "week,from,to"], { env })
      expect(r.exitCode, r.stderr).toBe(0)
      return r.json()
    }

    const last = shiftWeek(thisWeek(), -1)
    expect(await run("last")).toEqual({ week: last, ...weekBounds(last) })
    const next = shiftWeek(thisWeek(), 1)
    expect(await run("next")).toEqual({ week: next, ...weekBounds(next) })
    expect(await run("THIS")).toMatchObject({ week: thisWeek() })

    // Any day names its week, here a Wednesday and the following Sunday.
    expect(await run("2026-10-07")).toMatchObject({ week: "2026-10-05" })
    expect(await run("2026-10-11")).toMatchObject({ week: "2026-10-05" })
  })

  test("a task planned in an earlier week is carried over; one parked in Backlog is not", async () => {
    const w = await world(server)
    const old = await w.addTask({ title: "Old work", assigneeIds: [w.me] })
    const parked = await w.addTask({ title: "Parked", status: "backlog", assigneeIds: [w.me] })
    const { from } = weekBounds(thisWeek())
    const before = new Date(new Date(from).getTime() - 3 * 86_400_000).toISOString()
    for (const table of ["taskAssignments", "taskStatusHistory"] as const) {
      const column = table === "taskAssignments" ? "assignedAt" : "updatedAt"
      await server.db
        .updateTable(table)
        .set({ [column]: before })
        .where("taskId", "in", [old.id, parked.id])
        .execute()
    }

    const r = await w.box.run(["week"], { env })
    expect(r.exitCode, r.stderr).toBe(0)
    expect(r.stdout).toMatch(new RegExp(`${old.key}.*Old work — .*carried over, assigned `))
    expect(r.stdout).toMatch(new RegExp(`${parked.key}.*Parked — Backlog · assigned `))
  })

  test("a bad week is a usage error", async () => {
    const w = await world(server)
    for (const input of ["soon", "2026-13-01", "2026-02-31"]) {
      const r = await w.box.run(["week", input], { env })
      expect(r.exitCode, input).toBe(2)
      expect(r.stderr).toContain(`"${input}" is not a week`)
      expect(r.stderr).toContain("this, last, next")
    }
    const json = await w.box.run(["week", "soon", "--json"], { env })
    expect(json.exitCode).toBe(2)
    expect(JSON.parse(json.stderr).error.code).toBe("USAGE_ERROR")
  })

  test("works with a read-only token", async () => {
    const w = await world(server, { scope: "read" })
    const r = await w.box.run(["week", "--json", "--fields", "people"], { env })
    expect(r.exitCode, r.stderr).toBe(0)
    expect(r.json().people).toHaveLength(1)
  })

  test("logged out, exits 4", async () => {
    expect((await sandbox(server.url).run(["week"], { env })).exitCode).toBe(4)
  })
})
