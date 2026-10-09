import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { totpCode } from "../../api/src/auth/totp"
import { loginAs, removeSandboxes, sandbox, startServer, type TestServer } from "./helpers"

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => {
  server.stop()
  removeSandboxes()
})

let counter = 0
async function signedIn(opts: { scope?: "read" | "write" } = {}) {
  const box = sandbox(server.url)
  const email = `me-${++counter}@example.com`
  await loginAs(box, server, email, opts)
  return { box, email }
}

const dbUser = (email: string) =>
  server.db.selectFrom("users").selectAll().where("email", "=", email).executeTakeFirstOrThrow()

describe("me", () => {
  test("`me` and `me view` print the signed-in user", async () => {
    const { box, email } = await signedIn()
    const [bare, view] = await Promise.all([
      box.run(["me", "--json"]),
      box.run(["me", "view", "--json"]),
    ])
    expect(view.exitCode).toBe(0)
    expect(view.json()).toMatchObject({ email, totpEnabled: false })
    expect(bare.stdout).toBe(view.stdout)
  })

  test("piped output is field and value rows", async () => {
    const { box, email } = await signedIn()
    const r = await box.run(["me"])
    expect(r.stdout).toContain(`email\t${email}\n`)
  })

  test("`me --help` lists the subcommands rather than describing `view`", async () => {
    const r = await sandbox().run(["me", "--help"])
    expect(r.exitCode).toBe(0)
    for (const verb of ["view", "edit", "2fa"]) expect(r.stdout).toContain(`${verb}:`)
  })

  test("not signed in exits 4", async () => {
    const r = await sandbox(server.url).run(["me"])
    expect(r.exitCode).toBe(4)
  })
})

describe("me edit", () => {
  test("--name renames the user and returns the result", async () => {
    const { box, email } = await signedIn()
    const r = await box.run(["me", "edit", "--name", "Renamed Person", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json().name).toBe("Renamed Person")
    expect((await dbUser(email)).name).toBe("Renamed Person")
  })

  test("--name is required when not interactive, and the error names it", async () => {
    const { box } = await signedIn()
    const r = await box.run(["me", "edit"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--name")
  })

  test("a blank name is rejected by the server (exit 8)", async () => {
    const { box } = await signedIn()
    expect((await box.run(["me", "edit", "--name", "   "])).exitCode).toBe(8)
  })

  test("a read-only token cannot edit (exit 7)", async () => {
    const { box } = await signedIn({ scope: "read" })
    expect((await box.run(["me", "edit", "--name", "X"])).exitCode).toBe(7)
  })
})

describe("me 2fa", () => {
  // The secret only exists after setup; scripts get it from `2fa setup` and then pass a code.
  async function setUp(box: ReturnType<typeof sandbox>) {
    const r = await box.run(["me", "2fa", "setup", "--json"])
    expect(r.exitCode).toBe(0)
    return r.json() as { secret: string; otpauthUrl: string }
  }

  test("setup prints the secret and the otpauth URL", async () => {
    const { box, email } = await signedIn()
    const { secret, otpauthUrl } = await setUp(box)
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(otpauthUrl).toStartWith("otpauth://totp/")
    expect(otpauthUrl).toContain(secret)
    expect((await dbUser(email)).totpEnabled).toBe(0)
  })

  test("enable --code turns two-factor on, disable --code turns it off", async () => {
    const { box, email } = await signedIn()
    const { secret } = await setUp(box)

    const enabled = await box.run([
      "me",
      "2fa",
      "enable",
      "--code",
      await totpCode(secret),
      "--json",
    ])
    expect(enabled.exitCode).toBe(0)
    expect(enabled.json().totpEnabled).toBe(true)
    expect((await dbUser(email)).totpEnabled).toBe(1)
    expect((await box.run(["me", "--json"])).json().totpEnabled).toBe(true)

    const disabled = await box.run([
      "me",
      "2fa",
      "disable",
      "--code",
      await totpCode(secret),
      "--json",
    ])
    expect(disabled.exitCode).toBe(0)
    expect(disabled.json().totpEnabled).toBe(false)
    const user = await dbUser(email)
    expect(user.totpEnabled).toBe(0)
    expect(user.totpSecret).toBeNull()
  })

  test("enable without --code exits 2 naming --code, and changes nothing", async () => {
    const { box, email } = await signedIn()
    const r = await box.run(["me", "2fa", "enable"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--code")
    expect(r.stdout).toBe("")
    expect((await dbUser(email)).totpSecret).toBeNull()
  })

  test("a wrong code exits 8 and leaves two-factor off", async () => {
    const { box, email } = await signedIn()
    const { secret } = await setUp(box)
    const wrong = String((Number(await totpCode(secret)) + 500_000) % 1_000_000).padStart(6, "0")
    const r = await box.run(["me", "2fa", "enable", "--code", wrong])
    expect(r.exitCode).toBe(8)
    expect((await dbUser(email)).totpEnabled).toBe(0)
  })

  test("a code that is not six digits is a usage error", async () => {
    const { box } = await signedIn()
    const r = await box.run(["me", "2fa", "enable", "--code", "12ab"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--code")
  })

  test("enable before setup is rejected by the server (exit 8)", async () => {
    const { box } = await signedIn()
    expect((await box.run(["me", "2fa", "enable", "--code", "123456"])).exitCode).toBe(8)
  })

  test("disable without --code exits 2 naming --code, and a wrong code exits 8", async () => {
    const { box, email } = await signedIn()
    const { secret } = await setUp(box)
    await box.run(["me", "2fa", "enable", "--code", await totpCode(secret)])

    const missing = await box.run(["me", "2fa", "disable"])
    expect(missing.exitCode).toBe(2)
    expect(missing.stderr).toContain("--code")

    const wrong = String((Number(await totpCode(secret)) + 500_000) % 1_000_000).padStart(6, "0")
    expect((await box.run(["me", "2fa", "disable", "--code", wrong])).exitCode).toBe(8)
    expect((await dbUser(email)).totpEnabled).toBe(1)
  })

  test("setup when already enabled conflicts (exit 6)", async () => {
    const { box } = await signedIn()
    const { secret } = await setUp(box)
    await box.run(["me", "2fa", "enable", "--code", await totpCode(secret)])
    expect((await box.run(["me", "2fa", "setup"])).exitCode).toBe(6)
  })

  test("the action is validated", async () => {
    const { box } = await signedIn()
    const r = await box.run(["me", "2fa", "toggle"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("setup|enable|disable")
  })
})
