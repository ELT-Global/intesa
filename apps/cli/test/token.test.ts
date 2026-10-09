import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  removeSandboxes,
  type Sandbox,
  signedIn as signIn,
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

const DAY_MS = 24 * 60 * 60 * 1000

// A signed-in sandbox, with a distinct user so tests never see each other's tokens.
const signedIn = (opts: { scope?: "read" | "write" } = {}) => signIn(server, opts)

type Listed = {
  id: string
  name: string
  scope: string
  expiresAt: string | null
  current: boolean
}
const listTokens = async (box: Sandbox): Promise<Listed[]> =>
  (await box.run(["token", "list", "--json"])).json()

describe("token create", () => {
  test("prints only the plaintext token on stdout and says it is shown once on stderr", async () => {
    const { box } = await signedIn()
    const r = await box.run(["token", "create", "--name", "ci"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/^intesa_pat_[\w-]{43}\n$/)
    expect(r.stderr).toContain("will not be shown again")
  })

  test("--json returns the token with its metadata", async () => {
    const { box } = await signedIn()
    const r = await box.run(["token", "create", "--name", "ci", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toMatchObject({ name: "ci", kind: "pat", scope: "write", expiresAt: null })
    expect(r.json().token).toStartWith("intesa_pat_")
    expect(r.json().lastFour).toBe(r.json().token.slice(-4))
  })

  test("the new token authenticates, and it is listed next to the one in use", async () => {
    const { box, tokenId } = await signedIn()
    const created = (await box.run(["token", "create", "--name", "laptop", "--json"])).json()
    const me = await box.run(["api", "/me"], { env: { INTESA_TOKEN: created.token } })
    expect(me.exitCode).toBe(0)

    const tokens = await listTokens(box)
    expect(tokens.find((t) => t.id === created.id)).toMatchObject({
      name: "laptop",
      current: false,
    })
    expect(tokens.find((t) => t.id === tokenId)?.current).toBe(true)
  })

  test("--scope read makes a token that can read but not write (exit 7)", async () => {
    const { box } = await signedIn()
    const { token } = (
      await box.run(["token", "create", "--name", "ro", "--scope", "read", "--json"])
    ).json()
    const env = { INTESA_TOKEN: token }
    expect((await box.run(["api", "/me"], { env })).exitCode).toBe(0)
    const write = await box.run(["api", "-X", "PATCH", "/me", "-f", "name=Nope"], { env })
    expect(write.exitCode).toBe(7)
  })

  test("an invalid --scope is a usage error", async () => {
    const { box } = await signedIn()
    const r = await box.run(["token", "create", "--name", "x", "--scope", "admin"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--scope")
  })

  test("--name is required when not interactive, and the error names it", async () => {
    const { box } = await signedIn()
    const r = await box.run(["token", "create"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--name")
    expect(r.stdout).toBe("")
  })

  test("a read-only token cannot create tokens (exit 7)", async () => {
    const { box } = await signedIn({ scope: "read" })
    expect((await box.run(["token", "create", "--name", "x"])).exitCode).toBe(7)
  })
})

describe("token create --expires", () => {
  const expiresOf = async (expires: string[]) => {
    const { box } = await signedIn()
    const r = await box.run(["token", "create", "--name", "e", "--json", ...expires])
    expect(r.exitCode).toBe(0)
    return r.json().expiresAt as string | null
  }

  test("Nd sets an expiry N days from now", async () => {
    const at = await expiresOf(["--expires", "30d"])
    expect(Math.abs(Date.parse(at ?? "") - (Date.now() + 30 * DAY_MS))).toBeLessThan(60_000)
  })

  test("a plain number means days", async () => {
    const at = await expiresOf(["--expires", "7"])
    expect(Math.abs(Date.parse(at ?? "") - (Date.now() + 7 * DAY_MS))).toBeLessThan(60_000)
  })

  test("`never` and omitting the flag both leave the token without an expiry", async () => {
    expect(await expiresOf(["--expires", "never"])).toBeNull()
    expect(await expiresOf([])).toBeNull()
  })

  test.each(["soon", "30x", "-5d", "1.5d", "0d", "3651d", ""])(
    "%p is a usage error",
    async (value) => {
      const { box } = await signedIn()
      const r = await box.run(["token", "create", "--name", "e", `--expires=${value}`])
      expect(r.exitCode).toBe(2)
      expect(r.stderr).toContain("--expires")
      expect(r.stdout).toBe("")
    },
  )
})

describe("token list", () => {
  test("piped output is TSV with a row per token, and -q prints the ids", async () => {
    const { box, tokenId } = await signedIn()
    const created = (await box.run(["token", "create", "--name", "second", "--json"])).json()

    const ids = (await box.run(["token", "list", "-q"])).stdout.trim().split("\n")
    expect(ids.sort()).toEqual([created.id, tokenId].sort())

    const tsv = await box.run(["token", "list"])
    const row = tsv.stdout.split("\n").find((l) => l.startsWith(`${created.id}\t`))
    expect(row?.split("\t")).toContain("second")
  })

  test("a terminal table has a header and a column marking the token in use", async () => {
    const { box } = await signedIn()
    const r = await box.run(["token", "list"], { env: { INTESA_FORCE_TTY: "250" } })
    const [header, row] = r.stdout.split("\n")
    expect(header).toMatch(/^ID\s+NAME\s+KIND\s+SCOPE\s+LASTFOUR\s+CREATEDAT.*CURRENT$/)
    expect(row).toMatch(/\btrue$/)
  })

  test("a terminal table shows dates relative to now; piped output keeps ISO", async () => {
    const { box } = await signedIn()
    await box.run(["token", "create", "--name", "idle"])
    const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:/
    const tty = await box.run(["token", "list"], { env: { INTESA_FORCE_TTY: "250" } })
    const idle = tty.stdout.split("\n").find((l) => l.includes("idle"))
    expect(idle).not.toMatch(ISO)
    // Created just now, never used, never expires.
    expect(idle).toMatch(/\bnow\b.*\bnever\b.*\bno expiry\b/)
    const piped = await box.run(["token", "list"])
    expect(piped.stdout).toMatch(ISO)
    expect(piped.stdout).not.toContain("no expiry")
    const json = await box.run(["token", "list", "--json"], { env: { INTESA_FORCE_TTY: "250" } })
    expect(json.json()[0].createdAt).toMatch(ISO)
  })

  test("--fields narrows the columns", async () => {
    const { box } = await signedIn()
    const r = await box.run(["token", "list", "--json", "--fields", "name,scope"])
    expect(r.json()).toEqual([{ name: "cli test", scope: "write" }])
  })
})

describe("token revoke", () => {
  test("refuses without --yes when it cannot prompt, and leaves the token alone", async () => {
    const { box } = await signedIn()
    const created = (await box.run(["token", "create", "--name", "keep", "--json"])).json()
    const r = await box.run(["token", "revoke", created.id])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--yes")
    expect((await listTokens(box)).some((t) => t.id === created.id)).toBe(true)
  })

  test("--yes revokes: the token disappears from the list and stops working (exit 4)", async () => {
    const { box } = await signedIn()
    const created = (await box.run(["token", "create", "--name", "gone", "--json"])).json()
    const env = { INTESA_TOKEN: created.token }
    expect((await box.run(["api", "/me"], { env })).exitCode).toBe(0)

    const r = await box.run(["token", "revoke", created.id, "--yes"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")

    expect((await listTokens(box)).some((t) => t.id === created.id)).toBe(false)
    expect((await box.run(["api", "/me"], { env })).exitCode).toBe(4)
  })

  test("--json reports what was revoked", async () => {
    const { box } = await signedIn()
    const created = (await box.run(["token", "create", "--name", "j", "--json"])).json()
    const r = await box.run(["token", "revoke", created.id, "--yes", "--json"])
    expect(r.json()).toEqual({ id: created.id, name: "j", deleted: true })
  })

  test("an unknown id exits 5", async () => {
    const { box } = await signedIn()
    const r = await box.run(["token", "revoke", crypto.randomUUID(), "--yes"])
    expect(r.exitCode).toBe(5)
  })

  test("another user's token is not found (exit 5)", async () => {
    const mine = await signedIn()
    const theirs = await signedIn()
    const r = await mine.box.run(["token", "revoke", theirs.tokenId, "--yes"])
    expect(r.exitCode).toBe(5)
    expect((await listTokens(theirs.box)).some((t) => t.id === theirs.tokenId)).toBe(true)
  })

  test("the id argument is required", async () => {
    const { box } = await signedIn()
    expect((await box.run(["token", "revoke", "--yes"])).exitCode).toBe(2)
  })
})
