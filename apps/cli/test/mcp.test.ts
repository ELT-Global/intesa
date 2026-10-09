import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { z } from "zod"
import pkg from "../package.json"
import { removeSandboxes, startServer, type TestServer, type World, world } from "./helpers"

// `intesa mcp` is spawned like an MCP client would: JSON-RPC lines are written to its stdin
// while it runs, and every line it prints is read back as a message.

const MAIN = resolve(import.meta.dir, "../src/main.ts")
const LEAKY = /^(INTESA_|NO_COLOR$|CLICOLOR|CI$|VISUAL$|EDITOR$|PAGER$|BROWSER$)/
const TIMEOUT = 20_000

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary message shapes
type Json = any

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

function connect(w: World, args: string[] = []) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !LEAKY.test(k)) env[k] = v
  Object.assign(env, {
    INTESA_CONFIG_DIR: w.box.configDir,
    INTESA_SECRETS: "file",
    INTESA_HOST: server.url,
  })
  const proc = Bun.spawn([process.execPath, MAIN, "mcp", ...args], {
    cwd: join(w.box.root, "work"),
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  const lines: string[] = []
  let ended = false
  let wake = () => {}
  const reading = (async () => {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true })
      const parts = buffer.split("\n")
      buffer = parts.pop() ?? ""
      lines.push(...parts)
      wake()
    }
    // A last line without a newline is kept, so the checks below see it.
    if (buffer) lines.push(buffer)
    ended = true
    wake()
  })()
  const stderr = new Response(proc.stderr).text()

  let read = 0
  let lastId = 0
  const next = async (): Promise<Json> => {
    while (lines.length <= read && !ended) await new Promise<void>((r) => (wake = r))
    const line = lines[read++]
    if (line === undefined) throw new Error(`intesa mcp ended:\n${await stderr}`)
    return JSON.parse(line)
  }
  const send = (msg: object | string) => {
    proc.stdin.write(`${typeof msg === "string" ? msg : JSON.stringify(msg)}\n`)
    proc.stdin.flush()
  }
  const request = async (method: string, params?: object): Promise<Json> => {
    const id = ++lastId
    send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })
    const reply = await next()
    expect(reply.id).toBe(id)
    return reply
  }
  const call = async (name: string, args?: object) => {
    const reply = await request("tools/call", { name, ...(args ? { arguments: args } : {}) })
    expect(reply.error).toBeUndefined()
    const result = reply.result as { content: { type: string; text: string }[]; isError: boolean }
    return { ...result, data: (): Json => JSON.parse(result.content[0]?.text ?? "") }
  }
  const initialize = (protocolVersion = "2025-06-18") =>
    request("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "mcp.test", version: "1.0.0" },
    })

  // Ends stdin like a client that quits, and checks that stdout held nothing but JSON-RPC.
  const close = async () => {
    proc.stdin.end()
    const exitCode = await proc.exited
    await reading
    for (const line of lines) {
      const msg = JSON.parse(line)
      expect(msg.jsonrpc).toBe("2.0")
      expect("result" in msg).not.toBe("error" in msg)
    }
    return { exitCode, lines, unread: lines.length - read, stderr: await stderr }
  }
  return { send, request, call, next, initialize, close }
}

describe("intesa mcp", () => {
  test(
    "answers the handshake and pings while its input stays open, and exits 0 at EOF",
    async () => {
      const c = connect(await world(server))
      const init = await c.initialize("2025-06-18")
      expect(init.result).toMatchObject({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "intesa", version: pkg.version },
      })
      expect(init.result.instructions).toBeString()

      // A notification gets no answer: the next line is the ping's.
      c.send({ jsonrpc: "2.0", method: "notifications/initialized" })
      expect((await c.request("ping")).result).toEqual({})

      const end = await c.close()
      expect(end.exitCode).toBe(0)
      expect(end.unread).toBe(0)
    },
    TIMEOUT,
  )

  test(
    "offers a version it supports when asked for one it does not know",
    async () => {
      const w = await world(server)
      const first = connect(w)
      const offered = (await first.initialize("1999-01-01")).result.protocolVersion
      expect(offered).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(offered).not.toBe("1999-01-01")
      await first.close()

      // Asking for the offered version gets exactly that one.
      const second = connect(w)
      expect((await second.initialize(offered)).result.protocolVersion).toBe(offered)
      await second.close()
    },
    TIMEOUT,
  )

  test(
    "lists one tool per usable command, with input schemas that validate",
    async () => {
      const c = connect(await world(server))
      await c.initialize()
      const { tools } = (await c.request("tools/list")).result as {
        tools: {
          name: string
          description: string
          inputSchema: Json
          annotations: Json
        }[]
      }
      await c.close()

      const names = tools.map((t) => t.name)
      expect(new Set(names).size).toBe(names.length)
      for (const name of [
        "task_list",
        "task_view",
        "task_create",
        "task_move",
        "task_delete",
        "artifact_upload",
        "project_list",
        "member_remove",
        "status",
        "api",
      ]) {
        expect(names).toContain(name)
      }
      for (const name of [
        "board",
        "completion",
        "mcp",
        "schema",
        "auth_login",
        "auth_logout",
        "auth_token",
        "config_set",
      ]) {
        expect(names).not.toContain(name)
      }

      for (const tool of tools) {
        expect(tool.name).toMatch(/^[a-z0-9_]+$/)
        expect(tool.description.length).toBeGreaterThan(0)
        expect(tool.inputSchema.type).toBe("object")
        for (const key of tool.inputSchema.required ?? []) {
          expect(Object.keys(tool.inputSchema.properties)).toContain(key)
        }
        expect(() => z.fromJSONSchema(tool.inputSchema), tool.name).not.toThrow()
      }

      const byName = (name: string) => tools.find((t) => t.name === name) as (typeof tools)[0]
      const create = z.fromJSONSchema(byName("task_create").inputSchema)
      expect(create.safeParse({ title: "Spec", project: "WEB", tag: ["docs"] }).success).toBe(true)
      expect(create.safeParse({ title: 3 }).success).toBe(false)
      expect(create.safeParse({ title: "Spec", colour: "red" }).success).toBe(false)

      expect(byName("task_list").annotations).toMatchObject({ readOnlyHint: true })
      expect(byName("task_list").inputSchema.properties["dry-run"]).toBeUndefined()
      expect(byName("task_create").annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      })
      expect(byName("task_create").inputSchema.properties["dry-run"]).toBeDefined()
      const remove = byName("task_delete")
      expect(remove.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
      expect(remove.inputSchema.properties.confirm).toMatchObject({ type: "boolean" })
      expect(remove.inputSchema.required).toEqual(["task"])
    },
    TIMEOUT,
  )

  test(
    "task_create then task_list returns the created task",
    async () => {
      const w = await world(server)
      const c = connect(w)
      await c.initialize()
      // A title starting with dashes must stay a title, not become a flag.
      const created = await c.call("task_create", {
        title: "--not-a-flag",
        project: "WEB",
        status: "review",
        priority: "high",
      })
      expect(created.isError).toBe(false)
      expect(created.data()).toMatchObject({
        key: "WEB-1",
        title: "--not-a-flag",
        status: "review",
        priority: "high",
      })

      const listed = await c.call("task_list", { project: "WEB", fields: ["key", "title"] })
      expect(listed.isError).toBe(false)
      expect(listed.data()).toEqual([{ key: "WEB-1", title: "--not-a-flag" }])
      expect((await c.close()).exitCode).toBe(0)

      const tasks = await w.projectTasks()
      expect(tasks.map((t: Json) => [t.title, t.status])).toEqual([["--not-a-flag", "review"]])
    },
    TIMEOUT,
  )

  test(
    "a failing command is an error result carrying the CLI's error envelope",
    async () => {
      const c = connect(await world(server))
      await c.initialize()
      const missing = await c.call("task_view", { task: "WEB-404" })
      expect(missing.isError).toBe(true)
      expect(missing.data().error).toMatchObject({ code: "NOT_FOUND", exitCode: 5 })

      const typo = await c.call("task_list", { project: "WEB", statuses: ["todo"] })
      expect(typo.isError).toBe(true)
      expect(typo.data().error).toMatchObject({ code: "USAGE_ERROR", exitCode: 2 })
      expect(typo.data().error.message).toContain("statuses")
      expect(typo.data().error.hint).toContain("status")
      await c.close()
    },
    TIMEOUT,
  )

  test(
    "a destructive tool runs only with confirm: true",
    async () => {
      const w = await world(server)
      const task = await w.addTask({ title: "Doomed" })
      const c = connect(w)
      await c.initialize()

      const refused = await c.call("task_delete", { task: task.key })
      expect(refused.isError).toBe(true)
      expect(refused.data().error).toMatchObject({ code: "USAGE_ERROR", exitCode: 2 })
      expect(refused.data().error.hint).toContain("confirm")
      expect(await w.getTask(task.id)).toBeDefined()

      const deleted = await c.call("task_delete", { task: task.key, confirm: true })
      expect(deleted.isError).toBe(false)
      expect(deleted.data()).toMatchObject({ key: task.key, deleted: true })
      await c.close()
      expect(await w.getTask(task.id)).toBeUndefined()
    },
    TIMEOUT,
  )

  test(
    "dry-run returns the request and changes nothing",
    async () => {
      const w = await world(server)
      const task = await w.addTask({ title: "Kept" })
      const c = connect(w)
      await c.initialize()

      const create = await c.call("task_create", {
        title: "Draft",
        project: "WEB",
        "dry-run": true,
      })
      expect(create.isError).toBe(false)
      expect(create.data()).toEqual({
        method: "POST",
        path: `/api/projects/${w.project.id}/tasks`,
        body: { title: "Draft" },
      })
      // Previewing a delete needs no confirmation.
      const remove = await c.call("task_delete", { task: task.key, "dry-run": true })
      expect(remove.data()).toMatchObject({ method: "DELETE", path: `/api/tasks/${task.id}` })
      await c.close()

      expect((await w.projectTasks()).map((t: Json) => t.title)).toEqual(["Kept"])
    },
    TIMEOUT,
  )

  test(
    "protocol errors are JSON-RPC errors, and a malformed line does not stop the server",
    async () => {
      const c = connect(await world(server))
      await c.initialize()

      const unknownTool = await c.request("tools/call", { name: "task_explode", arguments: {} })
      expect(unknownTool.error.code).toBe(-32602)
      expect(unknownTool.error.message).toContain("task_explode")
      expect((await c.request("resources/list")).error.code).toBe(-32601)

      c.send("{not json")
      expect(await c.next()).toMatchObject({ id: null, error: { code: -32700 } })
      c.send({ id: 99, method: "ping" })
      expect(await c.next()).toMatchObject({ id: 99, error: { code: -32600 } })

      expect((await c.request("ping")).result).toEqual({})
      const listed = await c.call("task_list", { project: "WEB" })
      expect(listed.isError).toBe(false)
      expect((await c.close()).exitCode).toBe(0)
    },
    TIMEOUT,
  )

  test(
    "tools cannot read stdin, which carries the protocol",
    async () => {
      const w = await world(server)
      const c = connect(w)
      await c.initialize()
      const r = await c.call("task_create", {
        title: "From stdin",
        project: "WEB",
        "body-file": "-",
      })
      expect(r.isError).toBe(true)
      expect(r.data().error.code).toBe("USAGE_ERROR")
      // The next request is still read and answered.
      expect((await c.request("ping")).result).toEqual({})
      await c.close()
      expect(await w.projectTasks()).toEqual([])
    },
    TIMEOUT,
  )

  test(
    "stdout carries one JSON-RPC message per answer, whatever the commands print",
    async () => {
      const w = await world(server)
      const task = await w.addTask({ title: "Noisy" })
      const c = connect(w)
      // Sent in one go, then EOF: a deletion that confirms on stderr, a failure, a dry run, a
      // malformed line and a notification. Each request is answered before the server exits.
      const batch = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "task_delete", arguments: { task: task.key, confirm: true } },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "task_view", arguments: { task: task.key } },
        },
        "]",
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "tag_create", arguments: { name: "dry", "dry-run": true } },
        },
      ]
      for (const msg of batch) c.send(msg)
      const end = await c.close()
      expect(end.exitCode).toBe(0)
      const replies = end.lines.map((l) => JSON.parse(l))
      expect(replies.map((r) => r.id)).toEqual([1, 2, 3, null, 4])
      expect(replies[1].result.content[1].text).toContain(task.key)
      expect(replies[2].result.isError).toBe(true)
      expect(replies[4].result.isError).toBe(false)
    },
    TIMEOUT,
  )

  test(
    "-w and -p given to the server are defaults a call can override",
    async () => {
      const w = await world(server)
      const ops = await w.addProject("Ops", "OPS")
      const c = connect(w, ["-w", w.workspace.slug, "-p", "WEB"])
      await c.initialize()
      expect((await c.call("task_create", { title: "Default" })).data().key).toBe("WEB-1")
      expect((await c.call("task_create", { title: "Elsewhere", project: "OPS" })).data().key).toBe(
        "OPS-1",
      )
      await c.close()
      expect((await w.projectTasks(ops.id)).map((t: Json) => t.title)).toEqual(["Elsewhere"])
    },
    TIMEOUT,
  )
})
