import { expect, type Page, test } from "@playwright/test"
import { uniqueEmail } from "../support/auth"
import { cliSandbox, type RunningCli, withTimeout } from "../support/cli"

test.describe.configure({ timeout: 90_000 })

let active: ReturnType<typeof cliSandbox> | undefined
test.afterEach(() => {
  // A CLI that is still waiting for approval must not outlive its test.
  active?.dispose()
  active = undefined
})

// The terminal side: `intesa auth login --no-browser` against the server under test, polling
// quickly so the test does not wait out the server's interval.
async function startLogin(host: string) {
  const box = cliSandbox(host)
  active = box
  const login = box.start(["auth", "login", "--no-browser"], { INTESA_DEVICE_POLL_MS: "200" })
  const [, userCode] = await login.waitForStderr(/one-time code: ([A-Z]{4}-[A-Z]{4})/)
  const [, printed] = await login.waitForStderr(/Open (\S+) in your browser/)
  // The CLI prints the server's public URL, which need not be the address the browser uses.
  const url = new URL(printed as string)
  expect(url.pathname).toBe("/device")
  expect(url.searchParams.get("code")).toBe(userCode)
  return { box, login, userCode: userCode as string, devicePath: `${url.pathname}${url.search}` }
}

// The browser side, signed out: sign in through the form and reach the confirmation step.
async function openAsSignedOutUser(page: Page, devicePath: string, userCode: string) {
  const email = uniqueEmail("cli")
  await page.goto(devicePath)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL(`/device?code=${userCode}`)
  await expect(page.getByLabel("Device code")).toHaveValue(userCode)
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("heading", { name: /^Approve intesa-cli on .+\?$/ })).toBeVisible()
  return email
}

const finished = (login: RunningCli) => withTimeout(login.exited, 30_000, "intesa auth login")

test("signing the CLI in through the browser hands it a token that logout revokes", async ({
  page,
  request,
  baseURL,
}) => {
  const { box, login, userCode, devicePath } = await startLogin(baseURL as string)
  const email = await openAsSignedOutUser(page, devicePath, userCode)

  await page.getByRole("button", { name: "Approve" }).click()
  await expect(page.getByRole("heading", { name: "Device approved." })).toBeVisible()

  expect(await finished(login)).toBe(0)
  expect(login.stderr()).toContain("Logged in to")
  expect(login.stderr()).toContain(email)

  const status = await box.run(["auth", "status", "--json"])
  expect(status.exitCode).toBe(0)
  expect(JSON.parse(status.stdout)).toMatchObject({ user: email, kind: "cli", storage: "file" })

  const printed = await box.run(["auth", "token"])
  expect(printed.exitCode).toBe(0)
  const token = printed.stdout.trim()
  expect(token).toMatch(/^intesa_cli_/)

  // The bare `request` fixture carries no cookie, so only the bearer token can authenticate.
  const bearer = { headers: { Authorization: `Bearer ${token}` } }
  const me = await request.get("/api/me", bearer)
  expect(me.status()).toBe(200)
  expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email)

  const logout = await box.run(["auth", "logout"])
  expect(logout.exitCode).toBe(0)
  expect((await request.get("/api/me", bearer)).status()).toBe(401)
  expect((await box.run(["auth", "status"])).exitCode).toBe(4)
})

test("denying the request in the browser makes the CLI exit 4", async ({ page, baseURL }) => {
  const { box, login, userCode, devicePath } = await startLogin(baseURL as string)
  await openAsSignedOutUser(page, devicePath, userCode)

  await page.getByRole("button", { name: "Deny" }).click()
  await expect(page.getByRole("heading", { name: "Request denied." })).toBeVisible()

  expect(await finished(login)).toBe(4)
  expect(login.stderr()).toContain("denied")
  expect(login.stderr()).not.toContain("Logged in to")
  expect((await box.run(["auth", "status"])).exitCode).toBe(4)
})
