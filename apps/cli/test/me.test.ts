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
  const { session } = await loginAs(box, server, email, opts)
  return { box, email, session }
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
  // An API token cannot enrol an authenticator, so tests do it the way the web app does.
  async function withTwoFactor() {
    const { box, email, session } = await signedIn()
    const setup = await session.call("POST", "/api/me/2fa/setup")
    expect(setup.status).toBe(200)
    const secret = setup.body.secret as string
    const enabled = await session.call("POST", "/api/me/2fa/enable", {
      code: await totpCode(secret),
    })
    expect(enabled.status).toBe(200)
    return { box, email, secret }
  }

  const wrongCode = async (secret: string) =>
    String((Number(await totpCode(secret)) + 500_000) % 1_000_000).padStart(6, "0")

  test("enable prints the settings URL on stdout and does not open a browser", async () => {
    const { box, email } = await signedIn()
    const r = await box.run(["me", "2fa", "enable"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe(`${server.url}/settings
`)
    expect(r.stderr).toContain("web app")
    expect(r.stderr).toContain(`${server.url}/settings`)
    expect((await dbUser(email)).totpSecret).toBeNull()
  })

  test("enable --json prints the URL as an object", async () => {
    const { box } = await signedIn()
    const r = await box.run(["me", "2fa", "enable", "--json"])
    expect(r.exitCode).toBe(0)
    expect(r.json()).toEqual({ url: `${server.url}/settings` })
  })

  test("enable when already enabled says so and prints no URL", async () => {
    const { box } = await withTwoFactor()
    const r = await box.run(["me", "2fa", "enable"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("")
    expect(r.stderr).toContain("already enabled")
  })

  test("disable --code turns two-factor off", async () => {
    const { box, email, secret } = await withTwoFactor()
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

  test("disable without --code exits 2 naming --code, and a wrong code exits 8", async () => {
    const { box, email, secret } = await withTwoFactor()

    const missing = await box.run(["me", "2fa", "disable"])
    expect(missing.exitCode).toBe(2)
    expect(missing.stderr).toContain("--code")

    expect(
      (await box.run(["me", "2fa", "disable", "--code", await wrongCode(secret)])).exitCode,
    ).toBe(8)
    expect((await dbUser(email)).totpEnabled).toBe(1)
  })

  test("a code that is not six digits is a usage error", async () => {
    const { box } = await signedIn()
    const r = await box.run(["me", "2fa", "disable", "--code", "12ab"])
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("--code")
  })

  test("disable when two-factor is off is rejected by the server (exit 8)", async () => {
    const { box } = await signedIn()
    expect((await box.run(["me", "2fa", "disable", "--code", "123456"])).exitCode).toBe(8)
  })

  test("setup is no longer an action, and the action is validated", async () => {
    const { box } = await signedIn()
    for (const action of ["setup", "toggle"]) {
      const r = await box.run(["me", "2fa", action])
      expect(r.exitCode).toBe(2)
      expect(r.stderr).toContain("enable|disable")
    }
  })
})
