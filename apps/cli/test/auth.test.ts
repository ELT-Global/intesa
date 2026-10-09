import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { clientWithToken, signIn } from "../../api/test/helpers"
import { readHosts } from "../src/config/config"
import {
  fakeServer,
  loginAs,
  removeSandboxes,
  type Sandbox,
  sandbox,
  startServer,
  type TestServer,
} from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

// Polls every 50 ms instead of the server's 5 s; the server answers slow_down, which the
// CLI must ride out until the approval lands.
const FAST = { env: { INTESA_DEVICE_POLL_MS: "50" } }
const CODE = /one-time code: ([A-Z]{4}-[A-Z]{4})/

const statusOf = async (box: Sandbox) => {
  const r = await box.run(["auth", "status", "--json"])
  expect(r.exitCode).toBe(0)
  return r.json()
}

const tokenWorks = async (token: string) =>
  (await clientWithToken(server.app, token).call("GET", "/api/me")).status === 200

describe("auth login (device flow)", () => {
  test("approving in the browser signs the CLI in", async () => {
    const box = sandbox(server.url)
    const login = box.start(["auth", "login", "--no-browser"], FAST)
    const [, code] = await login.waitForStderr(CODE)
    // The server builds the link from its public URL, which the test server leaves at its default.
    expect(login.stderr()).toContain(`/device?code=${code}`)

    const browser = await signIn(server.app, "device@example.com", "Dee Vice")
    const pending = await browser.call("GET", `/api/auth/device/${code}`)
    expect(pending.body.clientName).toMatch(/^intesa-cli on .+ \(\w+-\w+\)$/)
    expect((await browser.call("POST", `/api/auth/device/${code}/approve`)).status).toBe(204)

    expect(await login.exited).toBe(0)
    expect(login.stdout()).toBe("")
    expect(login.stderr()).toContain("Logged in to")
    expect(login.stderr()).toContain("device@example.com")

    const status = await statusOf(box)
    expect(status).toMatchObject({
      host: server.url,
      user: "device@example.com",
      name: "Dee Vice",
      kind: "cli",
      scope: "write",
      storage: "file",
      totpEnabled: false,
    })
    expect(status.expiresAt).toEqual(expect.any(String))
    expect(readHosts(box.configDir)[server.url]).toMatchObject({
      user: "device@example.com",
      tokenId: status.tokenId,
      kind: "cli",
      scope: "write",
      storage: "file",
    })
  })

  test("denying exits 4 and stores nothing", async () => {
    const box = sandbox(server.url)
    const login = box.start(["auth", "login", "--no-browser"], FAST)
    const [, code] = await login.waitForStderr(CODE)
    const browser = await signIn(server.app, "denier@example.com")
    expect((await browser.call("POST", `/api/auth/device/${code}/deny`)).status).toBe(204)

    expect(await login.exited).toBe(4)
    expect(login.stderr()).toContain("denied")
    expect(readHosts(box.configDir)[server.url]).toBeUndefined()
  })

  test("an expired request exits 4", async () => {
    const box = sandbox(server.url)
    const login = box.start(["auth", "login", "--no-browser", "--json"], FAST)
    const [, code] = await login.waitForStderr(CODE)
    await server.db
      .updateTable("deviceAuthorizations")
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where("userCode", "=", code ?? "")
      .execute()

    expect(await login.exited).toBe(4)
    const lines = login.stderr().trim().split("\n")
    expect(JSON.parse(lines.at(-1) ?? "").error.exitCode).toBe(4)
  })

  test("with exactly one workspace, it becomes the default", async () => {
    const browser = await signIn(server.app, "solo@example.com")
    await browser.call("POST", "/api/workspaces", { name: "Solo", slug: "solo-ws" })

    const box = sandbox(server.url)
    const r = await box.run(["auth", "login", "--dev", "--email", "solo@example.com"])
    expect(r.exitCode).toBe(0)
    const config = JSON.parse(readFileSync(join(box.configDir, "config.json"), "utf8"))
    expect(config.workspace).toBe("solo-ws")
  })
})

describe("auth login --dev", () => {
  test("signs in through dev-login and stores a token", async () => {
    const box = sandbox(server.url)
    const r = await box.run(["auth", "login", "--dev", "--email", "dev@example.com"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    const status = await statusOf(box)
    expect(status).toMatchObject({ user: "dev@example.com", scope: "write", storage: "file" })
  })

  test("--json prints the resulting status", async () => {
    const r = await sandbox(server.url).run([
      "auth",
      "login",
      "--dev",
      "--email",
      "devjson@example.com",
      "--json",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ host: server.url, user: "devjson@example.com" })
  })

  test("needs --email", async () => {
    const r = await sandbox(server.url).run(["auth", "login", "--dev"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--email")
  })

  test("is refused when the server does not offer dev sign-in", async () => {
    const paths: string[] = []
    const fake = fakeServer((req) => {
      paths.push(new URL(req.url).pathname)
      return Response.json({ google: true, devLogin: false })
    })
    try {
      const r = await sandbox(fake.url).run(["auth", "login", "--dev", "--email", "x@example.com"])
      expect(r.exitCode).toBe(2)
      expect(r.stderr).toContain("dev")
      expect(paths).toEqual(["/api/auth/config"])
    } finally {
      fake.stop()
    }
  })
})

describe("auth login --with-token", () => {
  test("verifies and stores a token read from stdin", async () => {
    const session = await signIn(server.app, "pat@example.com")
    const { body } = await session.call("POST", "/api/me/tokens", { name: "ci", scope: "read" })
    const box = sandbox(server.url)
    const r = await box.run(["auth", "login", "--with-token"], { stdin: `${body.token}\n` })
    expect(r.exitCode).toBe(0)
    expect(await statusOf(box)).toMatchObject({
      user: "pat@example.com",
      tokenId: body.id,
      tokenName: "ci",
      kind: "pat",
      scope: "read",
    })
  })

  test("a bad token exits 4 and stores nothing", async () => {
    const box = sandbox(server.url)
    const r = await box.run(["auth", "login", "--with-token"], {
      stdin: "intesa_pat_not-a-real-token\n",
    })
    expect(r.exitCode).toBe(4)
    expect(readHosts(box.configDir)[server.url]).toBeUndefined()
  })

  test("empty stdin is a usage error", async () => {
    const r = await sandbox(server.url).run(["auth", "login", "--with-token"], { stdin: "\n" })
    expect(r.exitCode).toBe(2)
  })
})

describe("auth logout", () => {
  test("revokes the token on the server and forgets it", async () => {
    const box = sandbox(server.url)
    const { token } = await loginAs(box, server, "leaver@example.com")
    const r = await box.run(["auth", "logout"])
    expect(r.exitCode).toBe(0)
    expect(await tokenWorks(token)).toBe(false)
    expect(readHosts(box.configDir)[server.url]).toBeUndefined()
    expect((await box.run(["auth", "status"])).exitCode).toBe(4)
  })

  test("a token that is already invalid is still forgotten", async () => {
    const box = sandbox(server.url)
    const { token, session } = await loginAs(box, server, "gone@example.com")
    const { body } = await session.call("GET", "/api/me/tokens")
    await session.call("DELETE", `/api/me/tokens/${body.tokens[0].id}`)
    expect(await tokenWorks(token)).toBe(false)

    const r = await box.run(["auth", "logout"])
    expect(r.exitCode).toBe(0)
    expect(readHosts(box.configDir)[server.url]).toBeUndefined()
  })

  test("when not logged in, exits 4", async () => {
    expect((await sandbox(server.url).run(["auth", "logout"])).exitCode).toBe(4)
  })
})

describe("auth status", () => {
  test("when logged out, exits 4 with a login hint", async () => {
    const r = await sandbox(server.url).run(["auth", "status"])
    expect(r.exitCode).toBe(4)
    expect(r.stdout).toBe("")
    expect(r.stderr).toContain("intesa auth login")
  })

  test("a revoked token exits 4", async () => {
    const box = sandbox(server.url)
    const { token } = await loginAs(box, server, "revoked-status@example.com")
    await clientWithToken(server.app, token).call("DELETE", "/api/me/tokens/current")
    expect((await box.run(["auth", "status"])).exitCode).toBe(4)
  })

  test("reports INTESA_TOKEN as env storage", async () => {
    const { token } = await loginAs(sandbox(server.url), server, "envstatus@example.com")
    const r = await sandbox(server.url).run(["auth", "status", "--json"], {
      env: { INTESA_TOKEN: token },
    })
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ user: "envstatus@example.com", storage: "env" })
  })

  test("--fields narrows the output", async () => {
    const box = sandbox(server.url)
    await loginAs(box, server, "fields@example.com")
    const r = await box.run(["auth", "status", "--json", "--fields", "user,storage"])
    expect(r.json()).toEqual({ user: "fields@example.com", storage: "file" })
  })
})

describe("auth token", () => {
  test("prints only the active token", async () => {
    const box = sandbox(server.url)
    const { token } = await loginAs(box, server, "printer@example.com")
    const r = await box.run(["auth", "token"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe(`${token}\n`)
    expect(r.stderr).toBe("")
  })

  test("when logged out, exits 4", async () => {
    const r = await sandbox(server.url).run(["auth", "token"])
    expect(r.exitCode).toBe(4)
    expect(r.stdout).toBe("")
  })
})

// The real server, except that /health reports `version` (or none).
function serverReporting(version: string | undefined) {
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/api/health"
        ? Response.json({ ok: true, ...(version && { version }) })
        : server.app.fetch(req),
  })
  return { url: `http://127.0.0.1:${proxy.port}`, stop: () => proxy.stop(true) }
}

describe("server version", () => {
  const mismatch = /intesa \d+\.x is talking to a 99\.x server; update with .*\/cli\/intesa\.js/

  test("auth status warns on stderr when the major versions differ", async () => {
    const proxy = serverReporting("99.1.0")
    try {
      const box = sandbox(proxy.url)
      await loginAs(box, { ...server, url: proxy.url }, "version-status@example.com")
      const r = await box.run(["auth", "status", "--json"])
      expect(r.exitCode).toBe(0)
      expect(r.stderr).toMatch(mismatch)
      expect(r.json()).toMatchObject({ user: "version-status@example.com" })
    } finally {
      proxy.stop()
    }
  })

  test("auth login warns too, once signed in", async () => {
    const proxy = serverReporting("99.0.0")
    try {
      const session = await signIn(server.app, "version-login@example.com")
      const { body } = await session.call("POST", "/api/me/tokens", { name: "ci" })
      const r = await sandbox(proxy.url).run(["auth", "login", "--with-token"], {
        stdin: `${body.token}\n`,
      })
      expect(r.exitCode).toBe(0)
      expect(r.stderr).toContain("Logged in to")
      expect(r.stderr).toMatch(mismatch)
    } finally {
      proxy.stop()
    }
  })

  test("the same major, or no version at all, says nothing", async () => {
    const box = sandbox(server.url)
    await loginAs(box, server, "version-same@example.com")
    expect((await box.run(["auth", "status"])).stderr).toBe("")

    const minor = serverReporting("0.99.0")
    try {
      const other = sandbox(minor.url)
      await loginAs(other, { ...server, url: minor.url }, "version-minor@example.com")
      expect((await other.run(["auth", "status"])).stderr).toBe("")
    } finally {
      minor.stop()
    }

    const silent = serverReporting(undefined)
    try {
      const other = sandbox(silent.url)
      await loginAs(other, { ...server, url: silent.url }, "version-none@example.com")
      const r = await other.run(["auth", "status"])
      expect(r.exitCode).toBe(0)
      expect(r.stderr).toBe("")
    } finally {
      silent.stop()
    }
  })
})

describe("--insecure-storage", () => {
  const login = async (email: string, env: Record<string, string | undefined>) => {
    const session = await signIn(server.app, email)
    const { body } = await session.call("POST", "/api/me/tokens", { name: "ci" })
    const box = sandbox(server.url)
    const r = await box.run(["auth", "login", "--with-token", "--insecure-storage"], {
      stdin: `${body.token}\n`,
      env,
    })
    return { box, r }
  }

  test("warns that the token sits in plain text in hosts.json", async () => {
    // INTESA_SECRETS is what the harness sets; without it the keychain would be allowed.
    const { box, r } = await login("insecure-warn@example.com", { INTESA_SECRETS: undefined })
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain(`stored in plain text in ${join(box.configDir, "hosts.json")}`)
    expect(readHosts(box.configDir)[server.url]).toMatchObject({ storage: "file" })
  })

  test("INTESA_SECRETS=file is a deliberate choice and stays quiet", async () => {
    const { r } = await login("insecure-quiet@example.com", { INTESA_SECRETS: "file" })
    expect(r.exitCode).toBe(0)
    expect(r.stderr).not.toContain("plain text")
  })
})
