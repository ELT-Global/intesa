import { sql } from "kysely"
import { createApp } from "../src/app"
import type { Config } from "../src/config"
import { createDb, type Db, migrate } from "../src/db"

const baseConfig: Config = {
  nodeEnv: "test",
  devLogin: true,
  publicUrl: "http://localhost:3000",
  secureCookies: false,
}

// With TEST_DATABASE_URL set to a postgres URL, all test apps share one connection pool on a
// dedicated schema that is emptied before every app (tests run one at a time). Without it each
// app gets a fresh in-memory SQLite database.
const pgUrl = process.env.TEST_DATABASE_URL
const usePg = Boolean(pgUrl && /^postgres(ql)?:\/\//.test(pgUrl))
const PG_SCHEMA = "intesa_test"
let pgDb: Promise<Db> | undefined

function sharedPgDb(url: string): Promise<Db> {
  pgDb ??= (async () => {
    const admin = await createDb(url)
    await sql`drop schema if exists ${sql.id(PG_SCHEMA)} cascade`.execute(admin)
    await sql`create schema ${sql.id(PG_SCHEMA)}`.execute(admin)
    await admin.destroy()

    const scoped = new URL(url)
    scoped.searchParams.set("options", `-c search_path=${PG_SCHEMA}`)
    const db = await createDb(scoped.toString())
    await migrate(db, PG_SCHEMA)
    return db
  })()
  return pgDb
}

async function openDb(): Promise<Db> {
  if (!usePg || !pgUrl) {
    const db = await createDb(":memory:")
    await migrate(db)
    return db
  }
  const db = await sharedPgDb(pgUrl)
  const { rows } = await sql<{ tablename: string }>`
    select tablename from pg_tables
    where schemaname = ${PG_SCHEMA} and tablename not like 'kysely_%'`.execute(db)
  const tables = rows.map((r) => sql.id(r.tablename))
  await sql`truncate table ${sql.join(tables)} cascade`.execute(db)
  return db
}

export async function createTestApp(overrides: Partial<Config> = {}) {
  const db = await openDb()
  const config = { ...baseConfig, ...overrides }
  return { app: createApp({ db, config }), db, config }
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>

export type Client = {
  cookie: string
  // Sends a request with this client's session cookie.
  request: (path: string, init?: RequestInit) => Promise<Response>
  // Convenience for JSON calls: returns status and parsed body.
  call: (
    method: string,
    path: string,
    body?: unknown,
    // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary response shapes
  ) => Promise<{ status: number; body: any; res: Response }>
}

export function clientWithCookie(app: TestApp["app"], cookie: string): Client {
  const request: Client["request"] = async (path, init = {}) =>
    app.request(path, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) },
    })
  const call: Client["call"] = async (method, path, body) => {
    const res = await request(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : undefined, res }
  }
  return { cookie, request, call }
}

export function sessionCookieFrom(res: Response): string {
  const header = res.headers.getSetCookie().find((c) => c.startsWith("intesa_session="))
  return header ? (header.split(";")[0] ?? "") : ""
}

// Signs in through dev-login and returns a client that carries the session cookie.
export async function signIn(app: TestApp["app"], email: string, name?: string) {
  const res = await app.request("/api/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name }),
  })
  if (res.status !== 200) throw new Error(`dev-login failed: ${res.status}`)
  return clientWithCookie(app, sessionCookieFrom(res))
}

// Adds an existing user (by email) to a workspace without going through the API.
export async function addMember(
  t: TestApp,
  workspaceId: string,
  email: string,
  role: "owner" | "member" = "member",
) {
  const user = await t.db
    .selectFrom("users")
    .select("id")
    .where("email", "=", email)
    .executeTakeFirstOrThrow()
  await t.db
    .insertInto("workspaceMembers")
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      userId: user.id,
      role,
      createdAt: new Date().toISOString(),
    })
    .execute()
  return user.id
}

export async function userId(t: TestApp, email: string) {
  return (
    await t.db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirstOrThrow()
  ).id
}

export async function addTag(t: TestApp, workspaceId: string, name: string) {
  const id = crypto.randomUUID()
  await t.db
    .insertInto("tags")
    .values({ id, workspaceId, name, color: "blue", createdAt: new Date().toISOString() })
    .execute()
  return id
}

// A workspace owner with one project, ready for task tests.
export async function setupProject(t: TestApp, email: string, projectName = "Website") {
  const owner = await signIn(t.app, email)
  const ws = await owner.call("POST", "/api/workspaces", {
    name: `WS ${email}`,
    slug: `ws-${crypto.randomUUID().slice(0, 8)}`,
  })
  const workspaceId = ws.body.workspace.id as string
  const proj = await owner.call("POST", `/api/workspaces/${workspaceId}/projects`, {
    name: projectName,
  })
  return { owner, workspaceId, project: proj.body.project as { id: string; key: string } }
}
