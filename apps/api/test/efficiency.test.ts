import { describe, expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import { createApp } from "../src/app"
import { createDb, migrate } from "../src/db"
import { signIn } from "./helpers"

const config = {
  nodeEnv: "test",
  devLogin: true,
  publicUrl: "http://localhost",
  secureCookies: false,
}

async function appWithQueryCounter() {
  const base = await createDb(":memory:")
  await migrate(base)
  const selects: string[] = []
  const db = base.withPlugin({
    transformQuery: (args) => {
      if (args.node.kind === "SelectQueryNode") selects.push(JSON.stringify(args.node))
      return args.node
    },
    transformResult: async (args) => args.result,
  })
  return { app: createApp({ db, config }), selects }
}

describe("per-request work", () => {
  test("the session is looked up once even when several routers guard the same prefix", async () => {
    const { app, selects } = await appWithQueryCounter()
    const me = await signIn(app, "once@example.com")
    const ws = await me.call("POST", "/api/workspaces", { name: "Acme" })

    selects.length = 0
    const res = await me.call("GET", `/api/workspaces/${ws.body.workspace.id}/projects`)
    expect(res.status).toBe(200)
    const sessionLookups = selects.filter((q) => q.includes('"sessions"'))
    expect(sessionLookups).toHaveLength(1)
  })
})

describe("API response compression", () => {
  async function seeded() {
    const { app } = await appWithQueryCounter()
    const me = await signIn(app, "gz@example.com")
    const ws = await me.call("POST", "/api/workspaces", { name: "Acme" })
    const project = await me.call("POST", `/api/workspaces/${ws.body.workspace.id}/projects`, {
      name: "Big",
    })
    for (let i = 0; i < 30; i++) {
      await me.call("POST", `/api/projects/${project.body.project.id}/tasks`, {
        title: `A reasonably long task title number ${i}`,
      })
    }
    return { me, projectId: project.body.project.id as string }
  }

  test("large JSON is gzipped for clients that accept it, and decodes to the same data", async () => {
    const { me, projectId } = await seeded()
    const plain = await me.request(`/api/projects/${projectId}/tasks`)
    const plainBody = await plain.text()
    expect(plain.headers.get("content-encoding")).toBeNull()
    expect(plainBody.length).toBeGreaterThan(1024)

    const zipped = await me.request(`/api/projects/${projectId}/tasks`, {
      headers: { "accept-encoding": "gzip" },
    })
    expect(zipped.headers.get("content-encoding")).toBe("gzip")
    expect(zipped.headers.get("vary")).toContain("Accept-Encoding")
    const bytes = Buffer.from(await zipped.arrayBuffer())
    expect(bytes.length).toBeLessThan(plainBody.length / 2)
    expect(gunzipSync(bytes).toString()).toBe(plainBody)
  })

  test("tiny responses are left alone", async () => {
    const { me } = await seeded()
    const res = await me.request("/api/health", { headers: { "accept-encoding": "gzip" } })
    expect(res.headers.get("content-encoding")).toBeNull()
  })
})
