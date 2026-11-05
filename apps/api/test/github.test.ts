import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createHmac } from "node:crypto"
import { parseLinkedKeys } from "../src/github/links"
import { addMember, createTestApp, setupProject, signIn, type TestApp } from "./helpers"

const REPO = "acme/web"

let clock = 0
// GitHub's updated_at; every event is newer than the last unless a test says otherwise.
const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString()

type PrState = { state?: "open" | "closed"; draft?: boolean; merged?: boolean; base?: string }

function pullRequest(number: number, more: PrState & { title?: string; body?: string } = {}) {
  return {
    number,
    title: more.title ?? `PR ${number}`,
    body: more.body ?? null,
    state: more.state ?? "open",
    draft: more.draft ?? false,
    merged_at: more.merged ? "2026-01-01T00:00:00Z" : null,
    html_url: `https://github.com/${REPO}/pull/${number}`,
    updated_at: tick(),
    user: { login: "mei" },
    base: { ref: more.base ?? "qa" },
    // GitHub fills it in for open PRs too, with a trial merge; only a merged PR's counts.
    merge_commit_sha: (more.merged ? `sha${number}` : `trial${number}`) as string | null,
  }
}

const sign = (body: string, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

// Where a workspace's webhook is, and the secret GitHub signs with.
type Hook = { t: TestApp; path: string; secret: string }

// Sends what GitHub sends: JSON, no Origin, no cookie, a signature and the event name.
async function deliver(
  hook: Hook,
  event: string,
  payload: unknown,
  signature: string | null = sign(JSON.stringify(payload), hook.secret),
) {
  const body = JSON.stringify(payload)
  const res = await hook.t.app.request(hook.path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      ...(signature !== null && { "x-hub-signature-256": signature }),
    },
    body,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

const prEvent = (hook: Hook, action: string, pr: ReturnType<typeof pullRequest>) =>
  deliver(hook, "pull_request", { action, repository: { full_name: "Acme/Web" }, pull_request: pr })

// GitHub's REST API as Intesa sees it; tests replace it where they need something else.
function stubGithub(respond: (url: string) => Response | Promise<Response>) {
  return spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) =>
    respond(String(input))) as typeof fetch)
}
const prResponse = (number: number, more: PrState = {}) =>
  new Response(JSON.stringify(pullRequest(number, more)), {
    headers: { "content-type": "application/json" },
  })
const byNumber = (url: string) => prResponse(Number(url.split("/").at(-1)))

afterEach(() => {
  ;(globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.()
})

async function setup() {
  const t = await createTestApp()
  const { owner, workspaceId, project } = await setupProject(t, "owner@example.com")
  const created = await owner.call("POST", `/api/workspaces/${workspaceId}/github`)
  const hook: Hook = {
    t,
    path: new URL(created.body.github.url).pathname,
    secret: created.body.secret,
  }
  await owner.call("PATCH", `/api/workspaces/${workspaceId}/github`, { token: "gh-token" })
  const create = async (status = "in_progress") => {
    const res = await owner.call("POST", `/api/projects/${project.id}/tasks`, {
      title: "Work",
      status,
    })
    return res.body.task as { id: string; key: string }
  }
  const view = async (taskId: string) => (await owner.call("GET", `/api/tasks/${taskId}`)).body.task
  const link = (taskId: string, number: number) =>
    owner.call("PATCH", `/api/tasks/${taskId}`, { pullRequest: `${REPO}#${number}` })
  return { t, hook, owner, workspaceId, project, create, view, link }
}

describe("webhook signature", () => {
  test("deliveries are refused when the webhook does not exist or the signature is missing or wrong", async () => {
    const { hook } = await setup()
    const unknown = { ...hook, path: "/api/webhooks/github/nope" }
    expect((await deliver(unknown, "ping", { zen: "hi" })).status).toBe(401)
    expect((await deliver(hook, "ping", { zen: "hi" }, null)).status).toBe(401)
    expect((await deliver(hook, "ping", { zen: "hi" }, "sha256=00")).status).toBe(401)
    const wrong = sign(JSON.stringify({ zen: "hi" }), "other-secret")
    expect((await deliver(hook, "ping", { zen: "hi" }, wrong)).status).toBe(401)
    expect(await deliver(hook, "ping", { zen: "hi" })).toEqual({ status: 200, body: { ok: true } })
  })

  test("each workspace's webhook has its own secret", async () => {
    const { t, hook } = await setup()
    const other = await setupProject(t, "other@example.com")
    const created = await other.owner.call("POST", `/api/workspaces/${other.workspaceId}/github`)
    expect(created.body.secret).not.toBe(hook.secret)
    const signedForOther = sign(JSON.stringify({ zen: "hi" }), created.body.secret)
    expect((await deliver(hook, "ping", { zen: "hi" }, signedForOther)).status).toBe(401)
  })

  test("a refused delivery changes nothing", async () => {
    const { hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create()
    await link(task.id, 1)
    const merged = pullRequest(1, { state: "closed", merged: true })
    const res = await deliver(
      hook,
      "pull_request",
      { action: "closed", repository: { full_name: REPO }, pull_request: merged },
      sign("{}", hook.secret),
    )
    expect(res.status).toBe(401)
    expect((await view(task.id)).status).toBe("in_progress")
  })

  test("events Intesa does not use are acknowledged and ignored", async () => {
    const { hook } = await setup()
    expect((await deliver(hook, "issues", { action: "opened" })).status).toBe(204)
    // Names an object has without being given them are not handlers either.
    expect((await deliver(hook, "constructor", {})).status).toBe(204)
    expect((await deliver(hook, "hasOwnProperty", {})).status).toBe(204)
  })

  test("a form-encoded delivery gets through to be told to send JSON", async () => {
    const { hook } = await setup()
    const body = `payload=${encodeURIComponent(JSON.stringify({ zen: "hi" }))}`
    const res = await hook.t.app.request(hook.path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(body, hook.secret),
      },
      body,
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain("application/json")
  })

  test("payloads bigger than GitHub ever sends are refused", async () => {
    const { hook } = await setup()
    const res = await hook.t.app.request(hook.path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "ping" },
      body: "x".repeat(25 * 1024 * 1024 + 1),
    })
    expect(res.status).toBe(400)
  })
})

describe("moving to review on merge", () => {
  test("merging the PR into the merge branch moves the task to review as GitHub", async () => {
    const { hook, owner, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create()
    await link(task.id, 7)

    const res = await prEvent(hook, "closed", pullRequest(7, { state: "closed", merged: true }))
    expect(res.body.moved).toEqual([{ task: task.key, to: "review" }])
    const after = await view(task.id)
    expect(after.status).toBe("review")
    expect(after.pullRequests[0]).toMatchObject({ number: 7, state: "merged", baseBranch: "qa" })
    const history = (await owner.call("GET", `/api/tasks/${task.id}/history`)).body.history
    expect(history.at(-1)).toMatchObject({
      fromStatus: "in_progress",
      toStatus: "review",
      updatedBy: { id: "github", name: "GitHub" },
    })
  })

  test("merging into another branch only updates the PR; the merge branch is the workspace's", async () => {
    const { hook, owner, workspaceId, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create()
    await link(task.id, 7)
    await prEvent(hook, "closed", pullRequest(7, { state: "closed", merged: true, base: "main" }))
    const after = await view(task.id)
    expect(after.status).toBe("in_progress")
    expect(after.pullRequests[0].state).toBe("merged")

    await owner.call("PATCH", `/api/workspaces/${workspaceId}/github`, { mergeBranch: "main" })
    const other = await create()
    await link(other.id, 8)
    await prEvent(hook, "closed", pullRequest(8, { state: "closed", merged: true, base: "main" }))
    expect((await view(other.id)).status).toBe("review")
  })

  test("a task someone moved by hand is left where it is", async () => {
    const { hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const inReview = await create("review")
    const backInTodo = await create("todo")
    await link(inReview.id, 1)
    await link(backInTodo.id, 2)
    await prEvent(hook, "closed", pullRequest(1, { state: "closed", merged: true }))
    await prEvent(hook, "closed", pullRequest(2, { state: "closed", merged: true }))
    expect((await view(inReview.id)).status).toBe("review")
    expect((await view(backInTodo.id)).status).toBe("todo")
  })

  test("with several PRs the task waits for all of them", async () => {
    const { hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create()
    await link(task.id, 1)
    await link(task.id, 2)

    await prEvent(hook, "closed", pullRequest(1, { state: "closed", merged: true }))
    expect((await view(task.id)).status).toBe("in_progress")
    await prEvent(hook, "closed", pullRequest(2, { state: "closed", merged: true }))
    expect((await view(task.id)).status).toBe("review")
  })

  test("a PR closed without merging does not hold the task back once another has merged", async () => {
    const { hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create()
    await link(task.id, 1)
    await link(task.id, 2)
    await prEvent(hook, "closed", pullRequest(1, { state: "closed", merged: true }))
    await prEvent(hook, "closed", pullRequest(2, { state: "closed" }))
    expect((await view(task.id)).status).toBe("review")
  })

  test("draft and closed-without-merging PRs only change the PR's state", async () => {
    const { hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create()
    await link(task.id, 3)

    await prEvent(hook, "converted_to_draft", pullRequest(3, { draft: true }))
    expect(await view(task.id)).toMatchObject({
      status: "in_progress",
      pullRequests: [{ state: "draft" }],
    })
    await prEvent(hook, "closed", pullRequest(3, { state: "closed" }))
    expect(await view(task.id)).toMatchObject({
      status: "in_progress",
      pullRequests: [{ state: "closed" }],
    })
  })

  test("an event older than what is stored does not overwrite it, and redelivery is harmless", async () => {
    const { hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create()
    await link(task.id, 4)
    const stale = pullRequest(4, { draft: true })
    const merged = pullRequest(4, { state: "closed", merged: true })
    await prEvent(hook, "closed", merged)
    await prEvent(hook, "converted_to_draft", stale)
    expect((await view(task.id)).pullRequests[0].state).toBe("merged")
    // Redelivery is from the same second as what is stored, so GitHub is asked about the PR.
    stubGithub(() => new Response(JSON.stringify(merged)))
    const again = await prEvent(hook, "closed", merged)
    expect(again.status).toBe(200)
    expect(again.body.moved).toEqual([])
    expect((await view(task.id)).status).toBe("review")
  })

  test("a PR GitHub could not be asked about is asked about again when another one merges", async () => {
    const { hook, create, link, view } = await setup()
    const task = await create()
    const offline = stubGithub(() => {
      throw new Error("offline")
    })
    await link(task.id, 9)
    offline.mockRestore()
    stubGithub((url) =>
      url.endsWith("/9") ? prResponse(9, { state: "closed", merged: true }) : byNumber(url),
    )
    await link(task.id, 1)
    await prEvent(hook, "closed", pullRequest(1, { state: "closed", merged: true }))
    expect(await view(task.id)).toMatchObject({
      status: "review",
      pullRequests: [{ number: 9, state: "merged" }, { number: 1 }],
    })
  })

  test("a PR GitHub still cannot be asked about does not hold the task back", async () => {
    const { hook, create, link, view } = await setup()
    const task = await create()
    const online = stubGithub(byNumber)
    await link(task.id, 1)
    online.mockRestore()
    stubGithub(() => {
      throw new Error("offline")
    })
    await link(task.id, 9)
    await prEvent(hook, "closed", pullRequest(1, { state: "closed", merged: true }))
    expect((await view(task.id)).status).toBe("review")
  })
})

describe("linking from the PR's text", () => {
  test("keywords like GitHub's 'fixes #12' link tasks, and plain mentions do not", () => {
    expect(parseLinkedKeys("Fixes ELT-151")).toEqual(["ELT-151"])
    expect(parseLinkedKeys("links: elt-3, ELT-4 and WEB-5\nCloses ELT-3")).toEqual([
      "ELT-3",
      "ELT-4",
      "WEB-5",
    ])
    expect(parseLinkedKeys("Resolved ELT-1. Linked ELT-2")).toEqual(["ELT-1", "ELT-2"])
    expect(parseLinkedKeys("Follow-up to ELT-150, see ELT-149")).toEqual([])
    expect(parseLinkedKeys("prefix ELT-1 fixing ELT-2")).toEqual([])
  })

  test("an opened PR links the tasks it names and starts those in Backlog or Todo", async () => {
    const { hook, create, view } = await setup()
    const todo = await create("todo")
    const backlog = await create("backlog")
    const review = await create("review")
    const res = await prEvent(
      hook,
      "opened",
      pullRequest(9, { body: `Fixes ${todo.key}, ${backlog.key} and ${review.key}.` }),
    )
    expect(res.body).toMatchObject({
      linked: [todo.key, backlog.key, review.key],
      ignoredKeys: [],
    })
    expect(res.body.moved).toEqual([
      { task: todo.key, to: "in_progress" },
      { task: backlog.key, to: "in_progress" },
    ])
    expect((await view(review.id)).status).toBe("review")
    const linked = (await view(todo.id)).pullRequests[0]
    expect(linked).toMatchObject({
      repo: REPO,
      number: 9,
      source: "auto",
      linkedBy: null,
      state: "open",
    })
  })

  test("keys are looked up only in the webhook's workspace", async () => {
    const { t, hook, create } = await setup()
    const task = await create("todo")
    const other = await setupProject(t, "other@example.com")
    const theirs = await other.owner.call("POST", `/api/projects/${other.project.id}/tasks`, {
      title: "Not yours",
    })
    expect(theirs.body.task.key).toBe(task.key)
    const res = await prEvent(hook, "opened", pullRequest(9, { title: `Fixes ${task.key}` }))
    expect(res.body.linked).toEqual([task.key])
    const untouched = await other.owner.call("GET", `/api/tasks/${theirs.body.task.id}`)
    expect(untouched.body.task).toMatchObject({ status: "todo", pullRequests: [] })
  })

  test("an event changes only the webhook's workspace's copy of a PR", async () => {
    const { t, hook } = await setup()
    stubGithub(() => prResponse(12))
    const other = await setupProject(t, "other@example.com")
    const theirs = await other.owner.call("POST", `/api/projects/${other.project.id}/tasks`, {
      title: "Theirs",
      status: "in_progress",
    })
    const taskId = theirs.body.task.id
    await other.owner.call("PATCH", `/api/tasks/${taskId}`, { pullRequest: `${REPO}#12` })
    // Signed with our secret, about the PR on their task, and dated far ahead.
    const forged = {
      ...pullRequest(12, { state: "closed", merged: true, title: "Forged" }),
      html_url: "https://github.com/evil/login",
      updated_at: "9999-12-31T00:00:00Z",
    }
    expect((await prEvent(hook, "closed", forged)).status).toBe(200)
    const after = (await other.owner.call("GET", `/api/tasks/${taskId}`)).body.task
    expect(after).toMatchObject({
      status: "in_progress",
      pullRequests: [{ title: "PR 12", state: "open", url: `https://github.com/${REPO}/pull/12` }],
    })
  })

  test("a PR whose link is not on github.com is refused", async () => {
    const { hook, create, view } = await setup()
    const task = await create("todo")
    const pr = {
      ...pullRequest(9, { title: `Fixes ${task.key}` }),
      html_url: "javascript:alert(1)",
    }
    expect((await prEvent(hook, "opened", pr)).status).toBe(400)
    expect(await view(task.id)).toMatchObject({ status: "todo", pullRequests: [] })
  })

  test("a late or redelivered older event does not undo the links a newer one made", async () => {
    const { hook, create, view } = await setup()
    const first = await create("todo")
    const second = await create("todo")
    const opened = pullRequest(9, { body: `Fixes ${first.key}` })
    const edited = pullRequest(9, { body: `Fixes ${second.key}` })
    await prEvent(hook, "opened", opened)
    await prEvent(hook, "edited", edited)
    const late = await prEvent(hook, "opened", opened)
    expect(late.body).toMatchObject({ linked: [], unlinked: [], moved: [], stale: true })
    expect((await view(first.id)).pullRequests).toEqual([])
    expect((await view(second.id)).pullRequests).toMatchObject([{ number: 9 }])
  })

  test("a late event does not bring back links a newer one removed", async () => {
    const { hook, create, view } = await setup()
    const task = await create("todo")
    const opened = pullRequest(9, { body: `Fixes ${task.key}` })
    await prEvent(hook, "opened", opened)
    await prEvent(hook, "edited", pullRequest(9, { body: "nothing" }))
    const late = await prEvent(hook, "opened", opened)
    expect(late.body).toMatchObject({ linked: [], stale: true })
    expect((await view(task.id)).pullRequests).toEqual([])
  })

  test("of two events from the same second, GitHub says which is current", async () => {
    const { hook, create, view } = await setup()
    const first = await create("todo")
    const second = await create("todo")
    const edited = pullRequest(9, { body: `Fixes ${second.key}` })
    const opened = { ...edited, body: `Fixes ${first.key}` }
    const fetched = stubGithub(() => new Response(JSON.stringify(edited)))
    await prEvent(hook, "edited", edited)
    const late = await prEvent(hook, "opened", opened)
    expect(fetched).toHaveBeenCalledTimes(1)
    expect(late.body).toMatchObject({ linked: [], unlinked: [] })
    expect((await view(first.id)).pullRequests).toEqual([])
    expect((await view(second.id)).pullRequests).toMatchObject([{ number: 9 }])
  })

  test("only the first 10 keys in a PR are looked up", async () => {
    const { hook, create } = await setup()
    const keys: string[] = []
    for (let i = 0; i < 11; i++) keys.push((await create("todo")).key)
    const res = await prEvent(hook, "opened", pullRequest(9, { body: `Fixes ${keys.join(", ")}` }))
    expect(res.body.linked).toEqual(keys.slice(0, 10))
    expect(res.body.ignoredKeys).toEqual(keys.slice(10))
  })

  test("a PR someone unlinked is not linked again by its keywords, until linked by hand", async () => {
    const { owner, hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create("todo")
    await prEvent(hook, "opened", pullRequest(9, { body: `Fixes ${task.key}` }))
    const unlinkPullRequestId = (await view(task.id)).pullRequests[0].id
    await owner.call("PATCH", `/api/tasks/${task.id}`, { unlinkPullRequestId, status: "todo" })

    const res = await prEvent(hook, "synchronize", pullRequest(9, { body: `Fixes ${task.key}` }))
    expect(res.body).toMatchObject({ linked: [], moved: [] })
    expect(await view(task.id)).toMatchObject({ status: "todo", pullRequests: [] })

    await link(task.id, 9)
    expect((await view(task.id)).pullRequests).toMatchObject([{ number: 9, source: "manual" }])
  })

  test("the same PR linked several times at once is linked once", async () => {
    const { hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create("todo")
    const results = await Promise.all([
      link(task.id, 3),
      link(task.id, 3),
      prEvent(hook, "opened", pullRequest(3, { body: `Fixes ${task.key}` })),
      prEvent(hook, "edited", pullRequest(3, { body: `Fixes ${task.key}` })),
    ])
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200])
    expect((await view(task.id)).pullRequests).toMatchObject([{ number: 3, source: "manual" }])
  })

  test("keys of tasks that do not exist are reported and ignored", async () => {
    const { hook } = await setup()
    const res = await prEvent(hook, "opened", pullRequest(9, { title: "Fixes NOPE-1" }))
    expect(res.body).toMatchObject({ linked: [], ignoredKeys: ["NOPE-1"] })
  })

  test("removing the keyword unlinks an automatic link but never a manual one", async () => {
    const { hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const auto = await create("todo")
    const manual = await create()
    await link(manual.id, 9)
    await prEvent(hook, "opened", pullRequest(9, { body: `Fixes ${auto.key}` }))
    expect((await view(auto.id)).pullRequests).toHaveLength(1)

    const res = await prEvent(hook, "edited", pullRequest(9, { body: "nothing" }))
    expect(res.body.unlinked).toEqual([auto.key])
    expect((await view(auto.id)).pullRequests).toHaveLength(0)
    expect((await view(manual.id)).pullRequests).toHaveLength(1)
  })

  test("a merged PR that names an in-progress task links it and moves it to review", async () => {
    const { hook, create, view } = await setup()
    const task = await create()
    await prEvent(
      hook,
      "closed",
      pullRequest(5, { state: "closed", merged: true, title: `Fix ${task.key}` }),
    )
    expect((await view(task.id)).status).toBe("review")
  })
})

describe("linking by hand", () => {
  test("a move and its PR are saved together, with the details GitHub gives", async () => {
    const { owner, create, view } = await setup()
    const fetched = stubGithub(() => prResponse(12))
    const task = await create("todo")
    const res = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      status: "in_progress",
      pullRequest: "https://github.com/Acme/Web/pull/12",
    })
    expect(res.status).toBe(200)
    expect(String(fetched.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/acme/web/pulls/12",
    )
    const headers = fetched.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer gh-token")
    expect(await view(task.id)).toMatchObject({
      status: "in_progress",
      pullRequests: [
        { repo: REPO, number: 12, title: "PR 12", author: "mei", state: "open", source: "manual" },
      ],
    })
  })

  test("a PR GitHub says does not exist is refused and the move does not happen", async () => {
    const { owner, create, view } = await setup()
    stubGithub(() => new Response("{}", { status: 404 }))
    const task = await create("todo")
    const res = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      status: "in_progress",
      pullRequest: `${REPO}#404`,
    })
    expect(res.status).toBe(400)
    expect(await view(task.id)).toMatchObject({ status: "todo", pullRequests: [] })
  })

  test("when GitHub cannot be reached the PR is linked without details", async () => {
    const { link, create, view } = await setup()
    stubGithub(() => {
      throw new Error("offline")
    })
    const task = await create()
    expect((await link(task.id, 8)).status).toBe(200)
    expect((await view(task.id)).pullRequests[0]).toMatchObject({
      number: 8,
      url: `https://github.com/${REPO}/pull/8`,
      title: null,
      state: null,
    })
  })

  test("any page of the PR can be pasted, like its Files tab", async () => {
    const { owner, create, view } = await setup()
    stubGithub(() => prResponse(12))
    const task = await create()
    const res = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      pullRequest: "https://github.com/acme/web/pull/12/files#diff-1",
    })
    expect(res.status).toBe(200)
    expect((await view(task.id)).pullRequests).toMatchObject([{ repo: REPO, number: 12 }])
  })

  test("unlinking in the same write as a refused link unlinks nothing", async () => {
    const { owner, create, link, view } = await setup()
    const online = stubGithub(byNumber)
    const task = await create()
    await link(task.id, 1)
    const unlinkPullRequestId = (await view(task.id)).pullRequests[0].id
    online.mockRestore()
    stubGithub(() => new Response("{}", { status: 404 }))
    const refused = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      unlinkPullRequestId,
      pullRequest: `${REPO}#999`,
    })
    expect(refused.status).toBe(400)
    expect((await view(task.id)).pullRequests).toHaveLength(1)
    const res = await owner.call("PATCH", `/api/tasks/${task.id}`, {
      unlinkPullRequestId,
      title: "Renamed",
    })
    expect(res.body.task).toMatchObject({ title: "Renamed", pullRequests: [] })
  })

  test("'.' and '..' are refused as an owner or repository", async () => {
    const { owner, create } = await setup()
    const fetched = stubGithub(byNumber)
    const task = await create()
    for (const pullRequest of ["../..#1", "https://github.com/../x/pull/1", "acme/.#1"]) {
      const res = await owner.call("PATCH", `/api/tasks/${task.id}`, { pullRequest })
      expect(res.status).toBe(400)
    }
    expect(fetched).not.toHaveBeenCalled()
  })

  test("a bare number is refused, since it does not say which repository", async () => {
    const { owner, create } = await setup()
    const task = await create()
    const res = await owner.call("PATCH", `/api/tasks/${task.id}`, { pullRequest: "482" })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain("owner/repo#482")
  })

  test("unlinking keeps the task's status", async () => {
    const { owner, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create()
    await link(task.id, 1)
    const prId = (await view(task.id)).pullRequests[0].id
    const res = await owner.call("DELETE", `/api/tasks/${task.id}/pull-requests/${prId}`)
    expect(res.status).toBe(200)
    expect(res.body.task).toMatchObject({ status: "in_progress", pullRequests: [] })
    const again = await owner.call("DELETE", `/api/tasks/${task.id}/pull-requests/${prId}`)
    expect(again.status).toBe(404)
  })
})

describe("the workspace's webhook", () => {
  test("owners create it; the secret is shown once and the token never", async () => {
    const t = await createTestApp()
    const { owner, workspaceId } = await setupProject(t, "owner@example.com")
    const path = `/api/workspaces/${workspaceId}/github`
    expect((await owner.call("GET", path)).body.github).toBeNull()

    const created = await owner.call("POST", path)
    expect(created.status).toBe(201)
    expect(created.body.secret).toMatch(/^[0-9a-f]{48}$/)
    expect(created.body.github).toMatchObject({ mergeBranch: "qa", tokenSet: false })
    expect(created.body.github.url).toMatch(
      /^http:\/\/localhost:3000\/api\/webhooks\/github\/[0-9a-f-]{36}$/,
    )

    const patched = await owner.call("PATCH", path, { mergeBranch: "develop", token: "ghp_x" })
    expect(patched.body.github).toMatchObject({ mergeBranch: "develop", tokenSet: true })
    const seen = await owner.call("GET", path)
    expect(JSON.stringify(seen.body)).not.toContain(created.body.secret)
    expect(JSON.stringify(seen.body)).not.toContain("ghp_x")
    expect((await owner.call("PATCH", path, { mergeBranch: "bad branch" })).status).toBe(400)

    const workspaces = (await owner.call("GET", "/api/workspaces")).body.workspaces
    expect(workspaces.find((w: { id: string }) => w.id === workspaceId).github).toBe(true)
  })

  test("regenerating keeps the URL and refuses deliveries signed with the old secret", async () => {
    const { owner, workspaceId, hook } = await setup()
    const again = await owner.call("POST", `/api/workspaces/${workspaceId}/github`)
    expect(again.status).toBe(200)
    expect(new URL(again.body.github.url).pathname).toBe(hook.path)
    expect((await deliver(hook, "ping", {})).status).toBe(401)
    expect((await deliver({ ...hook, secret: again.body.secret }, "ping", {})).status).toBe(200)
  })

  test("members can see it but only owners change it", async () => {
    const { t, workspaceId } = await setup()
    await signIn(t.app, "member@example.com")
    await addMember(t, workspaceId, "member@example.com")
    const member = await signIn(t.app, "member@example.com")
    const path = `/api/workspaces/${workspaceId}/github`
    expect((await member.call("GET", path)).body.github).toMatchObject({ tokenSet: true })
    expect((await member.call("POST", path)).status).toBe(403)
    expect((await member.call("PATCH", path, { mergeBranch: "main" })).status).toBe(403)
    expect((await member.call("DELETE", path)).status).toBe(403)
  })

  test("deleting it stops deliveries and keeps linked PRs", async () => {
    const { owner, workspaceId, hook, create, link, view } = await setup()
    stubGithub(byNumber)
    const task = await create()
    await link(task.id, 1)
    expect((await owner.call("DELETE", `/api/workspaces/${workspaceId}/github`)).status).toBe(204)
    expect((await deliver(hook, "ping", {})).status).toBe(401)
    expect((await view(task.id)).pullRequests).toHaveLength(1)
  })

  test("nobody can sign in as the GitHub system user", async () => {
    const t = await createTestApp()
    const res = await t.app.request("/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "github@intesa.invalid" }),
    })
    expect(res.status).toBe(400)
  })
})

describe("where a task's code is", () => {
  // GitHub's compare API: whether each merge commit is in the branch. A list gives one answer
  // per call, the last one repeating.
  const compare = (statuses: Record<string, string | string[]>) => {
    const asked: Record<string, number> = {}
    return (url: string) => {
      if (/\/commits\/[^/]+\/pulls$/.test(url)) return new Response("[]")
      const match = /\/compare\/([^.]+)\.\.\.(.+)$/.exec(url)
      if (!match) return byNumber(url)
      const sha = match[1] as string
      const answers = [statuses[sha] ?? "diverged"].flat()
      const times = asked[sha] ?? 0
      asked[sha] = times + 1
      const status = answers[Math.min(times, answers.length - 1)]
      return new Response(JSON.stringify({ status }))
    }
  }
  const merge = (hook: Hook, number: number, base: string, body?: string) =>
    prEvent(hook, "closed", pullRequest(number, { state: "closed", merged: true, base, body }))
  const push = (hook: Hook, ref: string, more: object = {}, repo = "Acme/Web") =>
    deliver(hook, "push", { ref, repository: { full_name: repo }, ...more })
  const compareCalls = (fetched: ReturnType<typeof stubGithub>) =>
    fetched.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/compare/"))

  test("a PR merged into qa is in qa until a push to main finds its commit there", async () => {
    const { hook, create, view } = await setup()
    const fetched = stubGithub(compare({ sha7: "ahead" }))
    const task = await create("todo")
    await prEvent(hook, "opened", pullRequest(7, { body: `Fixes ${task.key}` }))
    await merge(hook, 7, "qa", `Fixes ${task.key}`)
    expect(await view(task.id)).toMatchObject({
      status: "review",
      pullRequests: [{ state: "merged", baseBranch: "qa", releasedTo: null }],
    })

    // The release PR's own delivery asks GitHub nothing; the push its merge makes does.
    expect((await merge(hook, 20, "main")).body.inMain).toBeUndefined()
    expect(compareCalls(fetched)).toEqual([])
    const release = await push(hook, "refs/heads/main", { after: "sha20" })
    expect(release.body.inMain).toEqual([task.key])
    expect((await view(task.id)).pullRequests[0].releasedTo).toBe("main")
    expect(compareCalls(fetched)).toEqual([
      "https://api.github.com/repos/acme/web/compare/sha7...sha20?per_page=1",
    ])
  })

  test("after a squash or rebase merge into main, the PRs are looked for in the merged PR's head", async () => {
    const { hook, create, view } = await setup()
    const fetched = stubGithub((url) =>
      url.endsWith("/commits/squash20/pulls")
        ? new Response(
            JSON.stringify([
              { merged_at: null, merge_commit_sha: "other", head: { sha: "wrong" } },
              {
                merged_at: "2026-01-01T00:00:00Z",
                merge_commit_sha: "squash20",
                head: { sha: "qatip" },
              },
            ]),
          )
        : compare({ sha7: "ahead" })(url),
    )
    const task = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${task.key}`)
    const release = await push(hook, "refs/heads/main", { after: "squash20" })
    expect(release.body.inMain).toEqual([task.key])
    expect((await view(task.id)).pullRequests[0].releasedTo).toBe("main")
    expect(compareCalls(fetched)).toEqual([
      "https://api.github.com/repos/acme/web/compare/sha7...qatip?per_page=1",
    ])
  })

  test("identical counts as in main; diverged stays in qa and is checked again next time", async () => {
    const { hook, create, view } = await setup()
    stubGithub(compare({ sha7: "identical", sha8: ["diverged", "ahead"] }))
    const first = await create("todo")
    const second = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${first.key}`)
    await merge(hook, 8, "qa", `Fixes ${second.key}`)

    expect((await push(hook, "refs/heads/main")).body.inMain).toEqual([first.key])
    expect((await view(second.id)).pullRequests[0].releasedTo).toBeNull()
    expect((await push(hook, "refs/heads/main")).body.inMain).toEqual([second.key])
    expect((await view(second.id)).pullRequests[0].releasedTo).toBe("main")
  })

  test("a PR merged straight into main is in main without asking GitHub", async () => {
    const { hook, create, view } = await setup()
    const fetched = stubGithub(compare({}))
    const task = await create("todo")
    const res = await merge(hook, 9, "main", `Fixes ${task.key}`)
    expect(res.body.inMain).toEqual([task.key])
    expect((await view(task.id)).pullRequests[0]).toMatchObject({
      baseBranch: "main",
      releasedTo: "main",
    })
    expect(fetched).not.toHaveBeenCalled()
  })

  test("without a token nothing is checked, and the reply says why", async () => {
    const { hook, owner, workspaceId, create, view } = await setup()
    await owner.call("PATCH", `/api/workspaces/${workspaceId}/github`, { token: null })
    const fetched = stubGithub(compare({ sha7: "ahead" }))
    const task = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${task.key}`)
    const release = await push(hook, "refs/heads/main")
    expect(release.body).toMatchObject({
      inMain: [],
      releaseCheck: expect.stringContaining("token"),
    })
    expect((await view(task.id)).pullRequests[0].releasedTo).toBeNull()
    expect(fetched).not.toHaveBeenCalled()
  })

  test("a merge commit the webhook never sent is asked for once and kept", async () => {
    const { t, hook, create, view } = await setup()
    const fetched = stubGithub((url) =>
      url.endsWith("/pulls/7")
        ? prResponse(7, { state: "closed", merged: true })
        : compare({ sha7: "ahead" })(url),
    )
    const task = await create("todo")
    const withoutSha = {
      ...pullRequest(7, { state: "closed", merged: true }),
      merge_commit_sha: null,
    }
    await prEvent(hook, "closed", { ...withoutSha, body: `Fixes ${task.key}` })

    await push(hook, "refs/heads/main")
    expect((await view(task.id)).pullRequests[0].releasedTo).toBe("main")
    const stored = await t.db.selectFrom("taskPullRequests").select("mergeCommitSha").execute()
    expect(stored).toEqual([{ mergeCommitSha: "sha7" }])
    expect(fetched.mock.calls.filter((c) => String(c[0]).endsWith("/pulls/7"))).toHaveLength(1)
  })

  test("a merge commit once known is kept when a later view of the PR leaves it out", async () => {
    const { t, hook, create } = await setup()
    const task = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${task.key}`)
    await prEvent(hook, "edited", {
      ...pullRequest(7, { state: "closed", merged: true, body: `Fixes ${task.key}` }),
      merge_commit_sha: null,
    })
    const stored = await t.db.selectFrom("taskPullRequests").select("mergeCommitSha").execute()
    expect(stored).toEqual([{ mergeCommitSha: "sha7" }])
  })

  test("an open PR's trial merge commit is not kept", async () => {
    const { t, hook, create } = await setup()
    const task = await create("todo")
    await prEvent(hook, "opened", pullRequest(7, { body: `Fixes ${task.key}` }))
    const stored = await t.db.selectFrom("taskPullRequests").select("mergeCommitSha").execute()
    expect(stored).toEqual([{ mergeCommitSha: null }])
  })

  test("another workspace's PRs are never looked at or changed", async () => {
    const { t, hook, create } = await setup()
    const fetched = stubGithub(compare({ sha7: "ahead", sha30: "ahead" }))
    const mine = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${mine.key}`)

    const other = await setupProject(t, "other@example.com")
    const created = await other.owner.call("POST", `/api/workspaces/${other.workspaceId}/github`)
    const otherHook = {
      t,
      path: new URL(created.body.github.url).pathname,
      secret: created.body.secret,
    }
    const theirs = await other.owner.call("POST", `/api/projects/${other.project.id}/tasks`, {
      title: "Theirs",
    })
    await merge(otherHook, 30, "qa", `Fixes ${theirs.body.task.key}`)

    expect((await push(hook, "refs/heads/main")).body.inMain).toEqual([mine.key])
    const urls = fetched.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes("sha30"))).toBe(false)
    const untouched = await other.owner.call("GET", `/api/tasks/${theirs.body.task.id}`)
    expect(untouched.body.task.pullRequests[0].releasedTo).toBeNull()
  })

  test("the production branch is the webhook's setting", async () => {
    const { hook, owner, workspaceId, create, view } = await setup()
    stubGithub(compare({ sha7: "ahead" }))
    const path = `/api/workspaces/${workspaceId}/github`
    expect((await owner.call("GET", path)).body.github.productionBranch).toBe("main")
    expect((await owner.call("PATCH", path, { productionBranch: "bad branch" })).status).toBe(400)
    const patched = await owner.call("PATCH", path, { productionBranch: "release" })
    expect(patched.body.github).toMatchObject({ mergeBranch: "qa", productionBranch: "release" })

    const task = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${task.key}`)
    expect((await push(hook, "refs/heads/main")).body.ignored).toEqual(expect.any(String))
    expect((await push(hook, "refs/heads/release")).body.inMain).toEqual([task.key])
    expect((await view(task.id)).pullRequests[0].releasedTo).toBe("release")

    const straight = await create("todo")
    expect((await merge(hook, 8, "main", `Fixes ${straight.key}`)).body.inMain).toBeUndefined()
    expect((await merge(hook, 9, "release", `Fixes ${straight.key}`)).body.inMain).toEqual([
      straight.key,
    ])
  })

  test("a push to the production branch finds the merged PRs there", async () => {
    const { hook, create, view } = await setup()
    const fetched = stubGithub(compare({ sha7: "ahead" }))
    const task = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${task.key}`)
    expect(await push(hook, "refs/heads/main")).toEqual({
      status: 200,
      body: { inMain: [task.key] },
    })
    expect((await view(task.id)).pullRequests[0].releasedTo).toBe("main")
    expect(compareCalls(fetched)).toEqual([
      "https://api.github.com/repos/acme/web/compare/sha7...main?per_page=1",
    ])
    // Found once: a redelivery reports nothing new and asks GitHub nothing.
    expect((await push(hook, "refs/heads/main")).body).toEqual({ inMain: [] })
    expect(compareCalls(fetched)).toHaveLength(1)
  })

  test("pushes to other branches, to tags, or deleting the branch change nothing", async () => {
    const { hook, create, view } = await setup()
    const fetched = stubGithub(compare({ sha7: "ahead" }))
    const task = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${task.key}`)
    for (const [ref, more] of [
      ["refs/heads/qa", {}],
      ["refs/tags/main", {}],
      ["refs/heads/mainline", {}],
      ["refs/heads/main", { deleted: true }],
    ] as const) {
      const res = await push(hook, ref, more)
      expect(res.status).toBe(200)
      expect(res.body.ignored).toEqual(expect.any(String))
    }
    expect((await view(task.id)).pullRequests[0].releasedTo).toBeNull()
    expect(compareCalls(fetched)).toEqual([])
    expect((await push(hook, "refs/heads/main", { ref: 1 })).status).toBe(400)
    expect((await deliver(hook, "push", { ref: "refs/heads/main" })).status).toBe(400)
  })

  test("a production branch with a slash in it works for pushes", async () => {
    const { hook, owner, workspaceId, create, view } = await setup()
    const fetched = stubGithub(compare({ sha7: "ahead" }))
    const path = `/api/workspaces/${workspaceId}/github`
    await owner.call("PATCH", path, { productionBranch: "release/2026" })
    const task = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${task.key}`)
    expect((await push(hook, "refs/heads/main")).body.ignored).toEqual(expect.any(String))
    expect((await push(hook, "refs/heads/release/2026")).body.inMain).toEqual([task.key])
    expect((await view(task.id)).pullRequests[0].releasedTo).toBe("release/2026")
    expect(compareCalls(fetched)).toEqual([
      "https://api.github.com/repos/acme/web/compare/sha7...release/2026?per_page=1",
    ])
  })

  test("only the pushed repository's PRs are checked", async () => {
    const { hook, create, view } = await setup()
    const fetched = stubGithub(compare({ sha7: "ahead", sha31: "ahead" }))
    const web = await create("todo")
    const api = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${web.key}`)
    await deliver(hook, "pull_request", {
      action: "closed",
      repository: { full_name: "Acme/Api" },
      pull_request: pullRequest(31, { state: "closed", merged: true, body: `Fixes ${api.key}` }),
    })

    expect((await push(hook, "refs/heads/main")).body.inMain).toEqual([web.key])
    expect(compareCalls(fetched).some((u) => u.includes("acme/api"))).toBe(false)
    expect((await view(api.id)).pullRequests[0].releasedTo).toBeNull()

    expect((await push(hook, "refs/heads/main", {}, "Acme/Api")).body.inMain).toEqual([api.key])
    expect(compareCalls(fetched).at(-1)).toBe(
      "https://api.github.com/repos/acme/api/compare/sha31...main?per_page=1",
    )
  })

  test("PRs GitHub cannot place are named in the reply and stay where they were", async () => {
    const { hook, create, view } = await setup()
    stubGithub((url) =>
      url.includes("/compare/") ? new Response("{}", { status: 403 }) : byNumber(url),
    )
    const task = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${task.key}`)
    await merge(hook, 8, "qa", `Fixes ${task.key}`)
    const res = await push(hook, "refs/heads/main")
    expect(res.body.inMain).toEqual([])
    expect(res.body.releaseCheck).toContain("acme/web #7, #8")
    expect(res.body.releaseCheck).toContain("contents")
    expect(
      (await view(task.id)).pullRequests.map((p: { releasedTo: unknown }) => p.releasedTo),
    ).toEqual([null, null])
  })

  test("the newest merged PRs are checked first, a few at a time", async () => {
    const { hook, create } = await setup()
    let inFlight = 0
    let most = 0
    const answer = compare({})
    const fetched = stubGithub(async (url) => {
      if (!url.includes("/compare/")) return answer(url)
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return answer(url)
    })
    const task = await create("todo")
    for (let n = 1; n <= 60; n++) await merge(hook, n, "qa", `Fixes ${task.key}`)
    const res = await push(hook, "refs/heads/main")
    expect(res.body).toEqual({ inMain: [] })
    const asked = compareCalls(fetched).map((u) => Number(/sha(\d+)\.\.\./.exec(u)?.[1]))
    expect(asked.sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 11))
    expect(most).toBeLessThanOrEqual(10)
    expect(most).toBeGreaterThan(1)
  })

  test("what is not checked in time is named in the reply and checked at the next push", async () => {
    const { hook, create, view } = await setup()
    // The check's deadline passes once GitHub has been asked about the first ten PRs.
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    const deadline = new AbortController()
    const timeouts = spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
      ms === 8000 ? deadline.signal : timeout(ms),
    )
    const answer = compare({ sha1: "ahead", sha12: "ahead" })
    let asked = 0
    const fetched = stubGithub((url) => {
      const response = answer(url)
      if (url.includes("/compare/") && ++asked === 10) deadline.abort()
      return response
    })
    const task = await create("todo")
    const last = await create("todo")
    for (let n = 1; n <= 11; n++) await merge(hook, n, "qa", `Fixes ${task.key}`)
    await merge(hook, 12, "qa", `Fixes ${last.key}`)
    try {
      const res = await push(hook, "refs/heads/main")
      // The first ten (12 down to 3) were already asked about; 2 and 1 were not.
      expect(res.body.inMain).toEqual([last.key])
      expect(res.body.releaseCheck).toContain("acme/web #1, #2 in time")
      expect(res.body.releaseCheck).toContain("next push")
      expect(compareCalls(fetched)).toHaveLength(10)
    } finally {
      timeouts.mockRestore()
    }
    expect((await push(hook, "refs/heads/main")).body.inMain).toEqual([task.key])
    expect((await view(task.id)).pullRequests.length).toBe(11)
  })

  test("without a token a push still finds PRs merged straight into main", async () => {
    const { t, hook, owner, workspaceId, create, view } = await setup()
    const fetched = stubGithub(compare({ sha7: "ahead" }))
    const straight = await create("todo")
    const viaQa = await create("todo")
    await merge(hook, 9, "main", `Fixes ${straight.key}`)
    await merge(hook, 7, "qa", `Fixes ${viaQa.key}`)
    // As it was before Intesa recorded releases.
    await t.db.updateTable("taskPullRequests").set({ releasedTo: null }).execute()
    await owner.call("PATCH", `/api/workspaces/${workspaceId}/github`, { token: null })
    fetched.mockClear()

    const res = await push(hook, "refs/heads/main")
    expect(res.body).toEqual({
      inMain: [straight.key],
      releaseCheck: expect.stringContaining("token"),
    })
    expect((await view(straight.id)).pullRequests[0].releasedTo).toBe("main")
    expect((await view(viaQa.id)).pullRequests[0].releasedTo).toBeNull()
    expect(fetched).not.toHaveBeenCalled()
  })

  test("a PR merged straight into main and linked by hand later is in main at once", async () => {
    const { create, view, link } = await setup()
    const fetched = stubGithub((url) =>
      url.endsWith("/pulls/9")
        ? prResponse(9, { state: "closed", merged: true, base: "main" })
        : compare({})(url),
    )
    const task = await create("review")
    await link(task.id, 9)
    expect((await view(task.id)).pullRequests[0].releasedTo).toBe("main")
    expect(compareCalls(fetched)).toEqual([])
  })

  test("linking a PR already found in main to another task shows it in main there too", async () => {
    const { hook, create, view, link } = await setup()
    stubGithub((url) =>
      url.endsWith("/pulls/7")
        ? prResponse(7, { state: "closed", merged: true })
        : compare({ sha7: "ahead" })(url),
    )
    const first = await create("todo")
    await merge(hook, 7, "qa", `Fixes ${first.key}`)
    await push(hook, "refs/heads/main")
    const second = await create("review")
    await link(second.id, 7)
    expect((await view(second.id)).pullRequests[0]).toMatchObject({
      state: "merged",
      releasedTo: "main",
    })
  })

  test("a merge into main is recorded by whichever delivery of it comes first", async () => {
    const { hook, create, view } = await setup()
    stubGithub(compare({}))
    const task = await create("todo")
    const closed = pullRequest(9, {
      state: "closed",
      merged: true,
      base: "main",
      body: `Fixes ${task.key}`,
    })
    const edited = await prEvent(hook, "edited", { ...closed, updated_at: tick() })
    expect(edited.body.inMain).toEqual([task.key])
    const late = await prEvent(hook, "closed", closed)
    expect(late.body).toMatchObject({ stale: true })
    expect(late.body.inMain).toBeUndefined()
    expect((await view(task.id)).pullRequests[0].releasedTo).toBe("main")
  })
})
