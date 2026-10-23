import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { keysOf, removeSandboxes, startServer, type TestServer, type World, world } from "./helpers"

let server: TestServer
let w: World
// biome-ignore lint/suspicious/noExplicitAny: API response shapes
let tasks: Record<"login" | "docs" | "deploy" | "api", any>

beforeAll(async () => {
  server = await startServer()
  w = await world(server)
  const api = await w.addProject("Api", "API")
  tasks = {
    login: await w.addTask({ title: "Fix login redirect" }),
    docs: await w.addTask({ title: "Write the docs" }),
    deploy: await w.addTask({ title: "Deploy the login page" }),
    api: await w.addTask({ title: "Rate limits" }, api.id),
  }
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

const relations = async (taskId: string) => {
  const t = await w.getTask(taskId)
  return { blocks: keysOf(t.blocks), blockedBy: keysOf(t.blockedBy), related: keysOf(t.related) }
}

describe("task link / unlink", () => {
  test("--blocks, --blocked-by and --related, across projects", async () => {
    const blocks = await w.box.run(["task", "link", "WEB-1", "--blocks", "WEB-2", "--json"])
    expect(blocks.exitCode, blocks.stderr).toBe(0)
    expect(keysOf(blocks.json().blocks)).toEqual(["WEB-2"])
    expect(blocks.json().url).toContain(`?task=${tasks.login.id}`)

    const by = await w.box.run(["task", "link", "web-1", "--blocked-by", "API-1"])
    expect(by.exitCode, by.stderr).toBe(0)
    expect(by.stderr).toContain("WEB-1 is blocked by API-1")
    expect(by.stdout).toContain("API-1")

    expect((await w.box.run(["task", "link", "WEB-1", "WEB-3", "--related"])).exitCode).toBe(0)
    expect(await relations(tasks.login.id)).toEqual({
      blocks: ["WEB-2"],
      blockedBy: ["API-1"],
      related: ["WEB-3"],
    })
    expect(await relations(tasks.api.id)).toMatchObject({ blocks: ["WEB-1"] })
  })

  test("none or several of --blocks, --blocked-by, --related is a usage error", async () => {
    for (const flags of [[], ["--blocks", "--related"]]) {
      const r = await w.box.run(["task", "link", "WEB-2", "WEB-3", ...flags])
      expect(r.exitCode).toBe(2)
      expect(r.stderr).toContain("pass one of --blocks, --blocked-by or --related")
    }
    expect((await relations(tasks.docs.id)).related).toEqual([])
  })

  test("a link that exists, or a circle of blocks, is a conflict", async () => {
    const twice = await w.box.run(["task", "link", "WEB-1", "--blocks", "WEB-2"])
    expect(twice.exitCode).toBe(6)
    const circle = await w.box.run(["task", "link", "WEB-2", "--blocks", "WEB-1"])
    expect(circle.exitCode).toBe(6)
    expect(circle.stderr).toContain("circular")
  })

  test("unlink finds the link from either side", async () => {
    // WEB-1 blocks WEB-2, so from WEB-2 it is blocked-by.
    const r = await w.box.run(["task", "unlink", "WEB-2", "WEB-1", "--json"])
    expect(r.exitCode, r.stderr).toBe(0)
    expect(r.json().blockedBy).toEqual([])
    expect((await relations(tasks.login.id)).blocks).toEqual([])
  })

  test("several links between the same tasks need --type", async () => {
    await w.box.run(["task", "link", "WEB-3", "--blocks", "WEB-1"])
    const ambiguous = await w.box.run(["task", "unlink", "WEB-1", "WEB-3"])
    expect(ambiguous.exitCode).toBe(2)
    expect(ambiguous.stderr).toContain("blocked-by, related")
    expect(ambiguous.stderr).toContain("--type")
    expect(await relations(tasks.login.id)).toMatchObject({
      blockedBy: ["API-1", "WEB-3"],
      related: ["WEB-3"],
    })

    const typed = await w.box.run(["task", "unlink", "WEB-1", "WEB-3", "--type", "related"])
    expect(typed.exitCode, typed.stderr).toBe(0)
    expect(await relations(tasks.login.id)).toMatchObject({
      blockedBy: ["API-1", "WEB-3"],
      related: [],
    })
  })

  test("tasks that are not linked, or not that way, exit 5", async () => {
    const none = await w.box.run(["task", "unlink", "WEB-2", "WEB-3"])
    expect(none.exitCode).toBe(5)
    expect(none.stderr).toContain("WEB-2 and WEB-3 are not linked")
    const wrongWay = await w.box.run(["task", "unlink", "WEB-1", "WEB-3", "--type", "blocks"])
    expect(wrongWay.exitCode).toBe(5)
    expect((await relations(tasks.login.id)).blockedBy).toEqual(["API-1", "WEB-3"])
  })
})

describe("task history", () => {
  test("every status change, oldest first", async () => {
    const t = await w.addTask({ title: "Moves around" })
    for (const status of ["in_progress", "review", "complete"]) {
      const signoff = status === "complete" ? ["--reviewed-by", "me", "--tested-by", "me"] : []
      expect((await w.box.run(["task", "move", t.key, status, ...signoff])).exitCode).toBe(0)
    }
    const r = await w.box.run(["task", "history", t.key, "--json"])
    expect(r.exitCode, r.stderr).toBe(0)
    const history = r.json()
    expect(history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      "todo",
      "in_progress",
      "review",
      "complete",
    ])
    expect(history[3]).toMatchObject({ fromStatus: "review", updatedBy: { name: "Alan Owner" } })

    const piped = await w.box.run(["task", "history", t.key])
    const lines = piped.stdout.trimEnd().split("\n")
    expect(lines).toHaveLength(4)
    expect(lines[3]).toMatch(/^\d{4}-\d\d-\d\dT.*\tAlan Owner\tReview -> Complete$/)
  })
})

describe("task search", () => {
  test("by title, in any case, across the workspace's projects", async () => {
    const r = await w.box.run(["task", "search", "LOGIN", "--json"])
    expect(r.exitCode, r.stderr).toBe(0)
    expect(keysOf(r.json()).sort()).toEqual(["WEB-1", "WEB-3"])
    expect(r.json()[0]).toEqual({
      id: expect.any(String),
      key: expect.any(String),
      title: expect.stringContaining("ogin"),
      status: "todo",
    })
    const words = await w.box.run(["task", "search", "rate", "limits"])
    expect(words.stdout).toBe("API-1\ttodo\tRate limits\n")
  })

  test("by key", async () => {
    const r = await w.box.run(["task", "search", "api-1", "-q"])
    expect(r.stdout).toBe("API-1\n")
  })

  test("nothing found is an empty list", async () => {
    const r = await w.box.run(["task", "search", "no such thing", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual([])
  })
})

describe("task url / open", () => {
  const link = () =>
    `${server.url}/w/${w.workspace.slug}/projects/${w.project.id}?task=${tasks.docs.id}`

  test("url prints the task's web link", async () => {
    const r = await w.box.run(["task", "url", "WEB-2"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe(`${link()}\n`)
    const json = await w.box.run(["task", "url", "2", "-p", "WEB", "--json"])
    expect(json.json()).toEqual({ id: tasks.docs.id, key: "WEB-2", url: link() })
  })

  test("open without a terminal opens nothing and prints the link on stderr", async () => {
    // A browser that would fail the test if it were started.
    const env = { BROWSER: `"${process.execPath}" -e process.exit(9)` }
    const r = await w.box.run(["task", "open", "WEB-2"], { env })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect(r.stderr).toBe(`Open ${link()} in your browser.\n`)
  })

  test("an unknown task exits 5", async () => {
    expect((await w.box.run(["task", "url", "WEB-99"])).exitCode).toBe(5)
  })
})
