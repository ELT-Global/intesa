import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { removeSandboxes, startServer, type TestServer, type World, world } from "./helpers"

let server: TestServer
let w: World

beforeAll(async () => {
  server = await startServer()
  w = await world(server)
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

// A PR linked as the webhook would, without asking GitHub.
async function linkPr(
  taskId: string,
  number: number,
  state: "open" | "merged" = "open",
  releasedTo: string | null = null,
) {
  const ts = new Date().toISOString()
  await server.db
    .insertInto("taskPullRequests")
    .values({
      id: crypto.randomUUID(),
      taskId,
      repo: "acme/web",
      number,
      url: `https://github.com/acme/web/pull/${number}`,
      title: `PR ${number}`,
      author: "mei",
      state,
      baseBranch: "qa",
      githubUpdatedAt: ts,
      releasedTo,
      source: "auto",
      linkedBy: null,
      createdAt: ts,
      updatedAt: ts,
    })
    .execute()
}

describe("github", () => {
  test("create prints the URL and the secret once; view never shows it", async () => {
    expect((await w.box.run(["github", "view"])).exitCode).toBe(2)

    const created = await w.box.run(["github", "create", "--json"])
    expect(created.exitCode).toBe(0)
    const { url, secret } = created.json()
    expect(url).toStartWith(`${server.config.publicUrl}/api/webhooks/github/`)
    expect(secret).toMatch(/^[0-9a-f]{48}$/)

    const viewed = await w.box.run(["github", "view", "--json"])
    expect(viewed.json()).toMatchObject({ url, mergeBranch: "qa", tokenSet: false })
    expect(viewed.stdout).not.toContain(secret)

    expect((await w.box.run(["github", "create"])).exitCode).toBe(2)
    const again = await w.box.run(["github", "create", "-q", "--yes"])
    expect(again.stdout.trim()).toMatch(/^[0-9a-f]{48}$/)
    expect(again.stdout.trim()).not.toBe(secret)
  })

  test("edit sets the merge branch, and token reads the token from stdin", async () => {
    const edited = await w.box.run(["github", "edit", "--merge-branch", "main", "--json"])
    expect(edited.json()).toMatchObject({ mergeBranch: "main", productionBranch: "main" })
    const production = await w.box.run([
      "github",
      "edit",
      "--production-branch",
      "release",
      "--json",
    ])
    expect(production.json()).toMatchObject({ mergeBranch: "main", productionBranch: "release" })
    expect((await w.box.run(["github", "edit"])).exitCode).toBe(2)

    expect((await w.box.run(["github", "token"], { stdin: "" })).exitCode).toBe(2)
    const set = await w.box.run(["github", "token", "--json"], { stdin: "ghp_secret\n" })
    expect(set.json()).toMatchObject({ tokenSet: true })
    expect(set.stdout).not.toContain("ghp_secret")
    const cleared = await w.box.run(["github", "token", "--clear", "--json"])
    expect(cleared.json()).toMatchObject({ tokenSet: false })
  })

  test("delete needs --yes without a terminal", async () => {
    expect((await w.box.run(["github", "delete"])).exitCode).toBe(2)
    expect((await w.box.run(["github", "delete", "--yes"])).exitCode).toBe(0)
    expect((await w.box.run(["github", "view"])).exitCode).toBe(2)
  })
})

describe("pull requests on tasks", () => {
  test("task view lists them, and --remove-pr unlinks one without moving the task", async () => {
    const task = await w.addTask({ title: "Ship it", status: "in_progress" })
    await linkPr(task.id, 7)
    await linkPr(task.id, 8, "merged")

    const view = await w.box.run(["task", "view", task.key])
    expect(view.stdout).toContain("Pull requests (2)")
    expect(view.stdout).toContain("acme/web#7\topen\t\tPR 7")
    expect(view.stdout).toContain(
      "acme/web#8\tmerged\tqa\tPR 8\thttps://github.com/acme/web/pull/8",
    )
    const json = await w.box.run(["task", "view", task.key, "--json", "--fields", "pullRequests"])
    expect(json.json().pullRequests).toMatchObject([
      { number: 7, state: "open" },
      { number: 8, state: "merged" },
    ])

    const edited = await w.box.run(["task", "edit", task.key, "--remove-pr", "#7", "--json"])
    expect(edited.exitCode).toBe(0)
    expect(edited.json()).toMatchObject({ status: "in_progress", pullRequests: [{ number: 8 }] })
    const missing = await w.box.run(["task", "edit", task.key, "--remove-pr", "7"])
    expect(missing.exitCode).toBe(5)
  })

  test("--remove-pr goes in the same request as the rest, so a refused edit unlinks nothing", async () => {
    const task = await w.addTask({ title: "Keep my PR", status: "in_progress" })
    await linkPr(task.id, 7)
    const refused = await w.box.run(["task", "edit", task.key, "--remove-pr", "7", "--pr", "482"])
    expect(refused.exitCode).toBe(8)
    expect(
      (await w.box.run(["task", "view", task.key, "--json"])).json().pullRequests,
    ).toHaveLength(1)

    const dry = await w.box.run([
      "task",
      "edit",
      task.key,
      "--remove-pr",
      "7",
      "--title",
      "New",
      "--dry-run",
    ])
    expect(dry.json()).toMatchObject({
      method: "PATCH",
      body: { title: "New", unlinkPullRequestId: expect.any(String) },
    })
  })

  test("--pr with a bare number is refused, and nothing moves", async () => {
    const task = await w.addTask({ title: "Start me", status: "todo" })
    const r = await w.box.run(["task", "start", task.key, "--pr", "482"])
    expect(r.exitCode).toBe(8)
    expect(r.stderr).toContain("owner/repo#482")
    expect((await w.getTask(task.id)).status).toBe("todo")
  })

  test("task view says where a merged PR's code is", async () => {
    const task = await w.addTask({ title: "Released", status: "review" })
    await linkPr(task.id, 9, "merged", "main")
    const view = await w.box.run(["task", "view", task.key])
    expect(view.stdout).toContain("acme/web#9\tmerged\tmain\tPR 9")
    const json = await w.box.run(["task", "view", task.key, "--json", "--fields", "pullRequests"])
    expect(json.json().pullRequests).toMatchObject([{ number: 9, releasedTo: "main" }])
  })
})
