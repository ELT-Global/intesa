import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  fakeServer,
  loginAs,
  removeSandboxes,
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

describe("intesa api", () => {
  test("GET prints the raw JSON body", async () => {
    const r = await sandbox(server.url).run(["api", "/health"])
    expect(r.exitCode).toBe(0)
    expect(r.json().ok).toBe(true)
    expect(r.stderr).toBe("")
  })

  test("the /api prefix is optional", async () => {
    const r = await sandbox(server.url).run(["api", "api/auth/config"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({ google: false, devLogin: true })
  })

  test("-f fields make a JSON body and default the method to POST", async () => {
    const r = await sandbox(server.url).run(["api", "/auth/dev-login", "-f", "email=f@example.com"])
    expect(r.exitCode).toBe(0)
    expect(r.json().user.email).toBe("f@example.com")
  })

  test("-F converts literals and reads @file values", async () => {
    const box = sandbox(server.url)
    writeFileSync(join(box.root, "name.txt"), "Fiona From File")
    const r = await box.run([
      "api",
      "/auth/dev-login",
      "-F",
      "email=ff@example.com",
      "-F",
      `name=@${join(box.root, "name.txt")}`,
    ])
    expect(r.exitCode).toBe(0)
    expect(r.json().user.name).toBe("Fiona From File")
  })

  test("--input sends a file as the body", async () => {
    const box = sandbox(server.url)
    const file = join(box.root, "body.json")
    writeFileSync(file, JSON.stringify({ email: "input@example.com" }))
    const r = await box.run(["api", "/auth/dev-login", "--input", file])
    expect(r.exitCode).toBe(0)
    expect(r.json().user.email).toBe("input@example.com")
  })

  test("--input - reads the body from stdin", async () => {
    const r = await sandbox(server.url).run(["api", "/auth/dev-login", "--input", "-"], {
      stdin: JSON.stringify({ email: "stdin@example.com" }),
    })
    expect(r.exitCode).toBe(0)
    expect(r.json().user.email).toBe("stdin@example.com")
  })

  test("-H sets request headers (a wrong content type fails validation, exit 8)", async () => {
    const r = await sandbox(server.url).run(
      ["api", "/auth/dev-login", "--input", "-", "-H", "Content-Type: application/xml"],
      { stdin: JSON.stringify({ email: "h@example.com" }) },
    )
    expect(r.exitCode).toBe(8)
    expect(r.stdout).toBe("")
  })

  test("-X GET with -f puts the fields in the query string", async () => {
    const r = await sandbox(server.url).run(
      ["api", "-X", "GET", "/auth/config", "-f", "a=1", "-f", "b=two words"],
      { env: { INTESA_DEBUG: "1" } },
    )
    expect(r.exitCode).toBe(0)
    expect(r.json().devLogin).toBe(true)
    expect(r.stderr).toContain(`GET ${server.url}/api/auth/config?a=1&b=two+words`)
  })

  test("-i prints the status line and headers before the body", async () => {
    const r = await sandbox(server.url).run(["api", "-i", "/health"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toStartWith("HTTP/1.1 200 OK\n")
    expect(r.stdout.toLowerCase()).toContain("content-type: application/json")
    expect(r.stdout).toContain('"ok":true')
  })

  test("sends a versioned User-Agent", async () => {
    let agent = ""
    const fake = fakeServer((req) => {
      agent = req.headers.get("user-agent") ?? ""
      return Response.json({ ok: true })
    })
    try {
      const r = await sandbox(fake.url).run(["api", "/health"])
      expect(r.exitCode).toBe(0)
      expect(agent).toMatch(/^intesa-cli\/\d+\.\d+\.\d+ \(\w+-\w+\)$/)
    } finally {
      fake.stop()
    }
  })
})

describe("authenticated requests", () => {
  test("uses the stored token for the host", async () => {
    const box = sandbox(server.url)
    await loginAs(box, server, "stored@example.com")
    const r = await box.run(["api", "/me"])
    expect(r.exitCode).toBe(0)
    expect(r.json().user.email).toBe("stored@example.com")
  })

  test("INTESA_TOKEN overrides the stored token", async () => {
    const box = sandbox(server.url)
    await loginAs(box, server, "stored2@example.com")
    const { token } = await loginAs(sandbox(server.url), server, "env@example.com")
    const r = await box.run(["api", "/me"], { env: { INTESA_TOKEN: token } })
    expect(r.json().user.email).toBe("env@example.com")
  })

  test("a revoked token exits 4 and suggests logging in again", async () => {
    const box = sandbox(server.url)
    await loginAs(box, server, "revoked@example.com")
    expect((await box.run(["api", "-X", "DELETE", "/me/tokens/current"])).exitCode).toBe(0)
    const r = await box.run(["api", "/me"])
    expect(r.exitCode).toBe(4)
    expect(r.stderr).toContain("expired or revoked")
    expect(r.stderr).toContain("intesa auth login")
  })

  test("a read-only token cannot write (exit 7)", async () => {
    const box = sandbox(server.url)
    await loginAs(box, server, "reader@example.com", { scope: "read" })
    const r = await box.run(["api", "-X", "PATCH", "/me", "-f", "name=Nope"])
    expect(r.exitCode).toBe(7)
    expect(r.stdout).toBe("")
  })
})

describe("errors map to exit codes", () => {
  test("unknown path exits 5 with the API message", async () => {
    const r = await sandbox(server.url).run(["api", "/nope"])
    expect(r.exitCode).toBe(5)
    expect(r.stdout).toBe("")
    expect(r.stderr).toContain("Not found")
  })

  test("--json errors are an envelope on stderr", async () => {
    const r = await sandbox(server.url).run(["api", "/nope", "--json"])
    expect(r.exitCode).toBe(5)
    expect(r.stdout).toBe("")
    expect(JSON.parse(r.stderr)).toEqual({
      error: { code: "NOT_FOUND", message: "Not found", exitCode: 5 },
    })
  })

  test("an authenticated path without credentials exits 4 with a login hint", async () => {
    const r = await sandbox(server.url).run(["api", "/me"])
    expect(r.exitCode).toBe(4)
    expect(r.stderr).toContain("Sign in required")
    expect(r.stderr).toContain("intesa auth login")
  })

  test("no host anywhere exits 4", async () => {
    const r = await sandbox().run(["api", "/health"])
    expect(r.exitCode).toBe(4)
    expect(r.stderr).toContain("intesa auth login")
  })

  test("GET retries twice on 5xx, then exits 1", async () => {
    let hits = 0
    const fake = fakeServer(() => {
      hits++
      return Response.json({ code: "INTERNAL", message: "Internal server error" }, { status: 503 })
    })
    try {
      const r = await sandbox(fake.url).run(["api", "/health"])
      expect(r.exitCode).toBe(1)
      expect(hits).toBe(3)
    } finally {
      fake.stop()
    }
  })

  test("mutations are never retried", async () => {
    let hits = 0
    const fake = fakeServer(() => {
      hits++
      return Response.json({ code: "INTERNAL", message: "Internal server error" }, { status: 500 })
    })
    try {
      const r = await sandbox(fake.url).run(["api", "-X", "POST", "/things"])
      expect(r.exitCode).toBe(1)
      expect(hits).toBe(1)
    } finally {
      fake.stop()
    }
  })
})

describe("--dry-run", () => {
  test("reads still run", async () => {
    const r = await sandbox(server.url).run(["api", "/health", "--dry-run"])
    expect(r.exitCode).toBe(0)
    expect(r.json().ok).toBe(true)
  })
})

describe("timeouts", () => {
  // A server that takes requests and never answers them.
  const silent = () => {
    let hits = 0
    const fake = fakeServer(() => {
      hits++
      return new Promise<Response>(() => {})
    })
    return { ...fake, hits: () => hits }
  }

  test("a request with no answer fails after INTESA_HTTP_TIMEOUT_MS (exit 1); reads are retried", async () => {
    const fake = silent()
    try {
      const r = await sandbox(fake.url).run(["api", "/health", "--json"], {
        env: { INTESA_HTTP_TIMEOUT_MS: "100" },
      })
      expect(r.exitCode).toBe(1)
      expect(JSON.parse(r.stderr).error).toMatchObject({ code: "NETWORK_ERROR", exitCode: 1 })
      expect(fake.hits()).toBe(3)
    } finally {
      fake.stop()
    }
  })

  test("completion gives up at once: no retries, nothing printed", async () => {
    const fake = silent()
    try {
      const r = await sandbox(fake.url).run(["__complete", "--word=", "--", "token", "revoke"], {
        env: { INTESA_HTTP_TIMEOUT_MS: "100" },
      })
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toBe("")
      expect(r.stderr).toBe("")
      expect(fake.hits()).toBe(1)
    } finally {
      fake.stop()
    }
  })
})

test("--fields does not apply to api: exit 2 before any request", async () => {
  const r = await sandbox(server.url).run(["api", "/health", "--fields", "ok"], {
    env: { INTESA_DEBUG: "1" },
  })
  expect(r.exitCode).toBe(2)
  expect(r.stderr).toContain("--fields")
  expect(r.stderr).not.toContain("> GET")
})

describe("debug logging", () => {
  test("INTESA_DEBUG=api logs requests to stderr with Authorization redacted", async () => {
    const secret = "intesa_pat_supersecretvalue1234567890"
    let sent = ""
    const fake = fakeServer((req) => {
      sent = req.headers.get("authorization") ?? ""
      return Response.json({ ok: true })
    })
    try {
      const r = await sandbox(fake.url).run(["api", "/health"], {
        env: { INTESA_DEBUG: "api", INTESA_TOKEN: secret },
      })
      expect(r.exitCode).toBe(0)
      expect(sent).toBe(`Bearer ${secret}`)
      expect(r.stderr).toContain(`GET ${fake.url}/api/health`)
      expect(r.stderr.toLowerCase()).toContain("authorization: bearer [redacted]")
      expect(r.stderr).not.toContain(secret)
      expect(r.stdout).not.toContain(secret)
    } finally {
      fake.stop()
    }
  })

  test("INTESA_DEBUG=api keeps credentials in bodies out of the log", async () => {
    const box = sandbox(server.url)
    await loginAs(box, server, "debug-bodies@example.com")
    const debug = { env: { INTESA_DEBUG: "api" } }
    const created = await box.run(["token", "create", "--name", "logged", "--json"], debug)
    expect(created.exitCode).toBe(0)
    const { token } = created.json()
    expect(created.stderr).toContain('"token":"[redacted]"')
    expect(created.stderr).toContain('"name":"logged"')
    expect(created.stderr).not.toContain(token)

    // The authenticator code a person sends; the error code that comes back stays readable.
    const disable = await box.run(["me", "2fa", "disable", "--code", "246813"], debug)
    expect(disable.exitCode).toBe(8)
    expect(disable.stderr).not.toContain("246813")
    expect(disable.stderr).toContain('"code":"VALIDATION_ERROR"')
  })
})
