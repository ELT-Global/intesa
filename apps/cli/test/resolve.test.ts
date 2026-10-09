import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { addMember, addTag, signIn } from "../../api/test/helpers"
import type { ResolvedContext } from "../src/client/context"
import { createHttp } from "../src/client/http"
import { resolver } from "../src/client/resolve"
import { readHosts } from "../src/config/config"
import { CliError } from "../src/output/errors"
import {
  loginAs,
  removeSandboxes,
  type Sandbox,
  sandbox,
  startServer,
  type TestServer,
} from "./helpers"

let server: TestServer
let box: Sandbox
let token: string
let workspace: { id: string; slug: string }
let project: { id: string; key: string }
let parent: { id: string; key: string }
let subtask: { id: string; key: string }
let tagId: string
let fieldId: string

beforeAll(async () => {
  server = await startServer()
  box = sandbox(server.url)
  const login = await loginAs(box, server, "resolver@example.com")
  token = login.token
  const { session } = login
  await session.call("PATCH", "/api/me", { name: "Rita Resolver" })
  workspace = (await session.call("POST", "/api/workspaces", { name: "Res", slug: "res-ws" })).body
    .workspace
  project = (
    await session.call("POST", `/api/workspaces/${workspace.id}/projects`, {
      name: "Web",
      key: "WEB",
    })
  ).body.project
  const tasks = `/api/projects/${project.id}/tasks`
  parent = (await session.call("POST", tasks, { title: "Parent" })).body.task
  subtask = (await session.call("POST", tasks, { title: "Child", parentTaskId: parent.id })).body
    .task

  for (const [email, name] of [
    ["sam.a@example.com", "Sam Smith"],
    ["sam.b@example.com", "Sam Smith"],
    ["una@example.com", "Una Unique"],
  ] as const) {
    await signIn(server.app, email, name)
    await addMember(server, workspace.id, email)
  }
  tagId = await addTag(server, workspace.id, "Bug")
  fieldId = (
    await session.call("POST", `/api/projects/${project.id}/custom-fields`, {
      name: "Estimate",
      type: "number",
    })
  ).body.field.id
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

// A resolver for a fresh invocation, recording the API paths it requests.
function invocation(context: { workspace?: string; project?: string } = {}) {
  const calls: string[] = []
  const http = createHttp({
    host: server.url,
    token,
    dryRun: false,
    debug: "off",
    stdout() {},
    stderr() {},
    fetch: ((req: Request) => {
      calls.push(new URL(req.url).pathname)
      return fetch(req)
    }) as typeof fetch,
  })
  const resolved: ResolvedContext = {
    host: { value: server.url, source: "flag" },
    ...(context.workspace && { workspace: { value: context.workspace, source: "flag" } }),
    ...(context.project && { project: { value: context.project, source: "flag" } }),
  }
  const r = resolver({ configDir: box.configDir, http: async () => http, context: () => resolved })
  return { r, calls }
}

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CliError)
    return err as CliError
  }
  throw new Error("expected a CliError")
}

describe("workspace", () => {
  test("the only workspace is used when none is given, and its id is cached", async () => {
    const { r } = invocation()
    expect(await r.workspace()).toMatchObject({ id: workspace.id, slug: "res-ws" })
    expect(readHosts(box.configDir)[server.url]?.workspace).toEqual({
      slug: "res-ws",
      id: workspace.id,
    })
  })

  test("a cached slug costs no request, so a task key costs exactly one", async () => {
    await invocation({ workspace: "res-ws" }).r.workspace()
    const { r, calls } = invocation({ workspace: "res-ws" })
    expect((await r.task("WEB-1")).id).toBe(parent.id)
    expect(calls).toEqual([`/api/workspaces/${workspace.id}/tasks/by-key/WEB-1`])
  })

  test("an unknown slug is not found (exit 5)", async () => {
    const err = await failure(invocation({ workspace: "nope" }).r.workspace())
    expect(err.exitCode).toBe(5)
    expect(err.message).toContain("nope")
  })
})

describe("task references", () => {
  test("a key in any case, including subtask keys", async () => {
    const { r } = invocation({ workspace: "res-ws" })
    expect((await r.task(parent.key.toLowerCase())).id).toBe(parent.id)
    const child = await r.task(subtask.key)
    expect(child.id).toBe(subtask.id)
    expect(child.parent?.id).toBe(parent.id)
  })

  test("a bare number uses the project context", async () => {
    const { r } = invocation({ workspace: "res-ws", project: "web" })
    expect((await r.task(subtask.key.split("-")[1] ?? "")).id).toBe(subtask.id)
  })

  test("a bare number without a project is a usage error naming -p", async () => {
    const err = await failure(invocation({ workspace: "res-ws" }).r.task("1"))
    expect(err.exitCode).toBe(2)
    expect(err.message).toContain("-p")
  })

  test("a UUID or a web link loads the task directly", async () => {
    const { r, calls } = invocation()
    expect((await r.task(subtask.id)).key).toBe(subtask.key)
    const link = `${server.url}/w/res-ws/projects/${project.id}?task=${parent.id}`
    expect((await r.task(link)).key).toBe(parent.key)
    expect(calls).toEqual([`/api/tasks/${subtask.id}`, `/api/tasks/${parent.id}`])
  })

  test("an unknown key exits 5, a malformed one exits 2", async () => {
    const { r } = invocation({ workspace: "res-ws" })
    expect((await failure(r.task("WEB-999"))).exitCode).toBe(5)
    expect((await failure(r.task("not a task"))).exitCode).toBe(2)
  })
})

describe("projects", () => {
  test("by key in any case or by id; unknown keys exit 5", async () => {
    const { r, calls } = invocation({ workspace: "res-ws" })
    expect((await r.project("web")).id).toBe(project.id)
    expect((await r.project(project.id)).key).toBe("WEB")
    expect(calls.filter((c) => c.endsWith("/projects"))).toHaveLength(1)
    expect((await failure(r.project("ZZZ"))).exitCode).toBe(5)
  })
})

describe("members", () => {
  test("by email or name, case-insensitive, or by id", async () => {
    const { r } = invocation({ workspace: "res-ws" })
    expect((await r.member("UNA@example.com")).email).toBe("una@example.com")
    const una = await r.member("una unique")
    expect((await r.member(una.id)).email).toBe("una@example.com")
    expect((await r.member(una.userId)).email).toBe("una@example.com")
  })

  test("@me is the signed-in user", async () => {
    const { r } = invocation({ workspace: "res-ws" })
    expect(await r.member("@me")).toMatchObject({
      email: "resolver@example.com",
      name: "Rita Resolver",
    })
  })

  test("an ambiguous name exits 2 and lists the candidates", async () => {
    const err = await failure(invocation({ workspace: "res-ws" }).r.member("sam smith"))
    expect(err.exitCode).toBe(2)
    expect(err.message).toContain("sam.a@example.com")
    expect(err.message).toContain("sam.b@example.com")
  })

  test("no match exits 5", async () => {
    const err = await failure(invocation({ workspace: "res-ws" }).r.member("Nobody"))
    expect(err.exitCode).toBe(5)
  })

  test("the member list is fetched once per invocation", async () => {
    const { r, calls } = invocation({ workspace: "res-ws" })
    await r.member("una@example.com")
    await r.member("@me")
    expect(calls.filter((c) => c.endsWith("/members"))).toHaveLength(1)
  })
})

describe("tags and custom fields", () => {
  test("by id or case-insensitive name", async () => {
    const { r } = invocation({ workspace: "res-ws" })
    expect((await r.tag("bug")).id).toBe(tagId)
    expect((await r.tag(tagId)).name).toBe("Bug")
    expect((await failure(r.tag("feature"))).exitCode).toBe(5)

    expect((await r.field(project.id, "ESTIMATE")).id).toBe(fieldId)
    expect((await r.field(project.id, fieldId)).name).toBe("Estimate")
  })
})
