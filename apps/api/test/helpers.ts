import { createApp } from "../src/app"
import type { Config } from "../src/config"
import { createDb, migrate } from "../src/db"

const baseConfig: Config = {
  nodeEnv: "test",
  devLogin: true,
  publicUrl: "http://localhost:3000",
  secureCookies: false,
}

export async function createTestApp(overrides: Partial<Config> = {}) {
  const db = await createDb(":memory:")
  await migrate(db)
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
