import { hostname } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { requireHost } from "../client/context"
import {
  createHttp,
  DryRunDone,
  debugLevel,
  dryRunWrite,
  type Http,
  timeoutMs,
} from "../client/http"
import { cacheWorkspace, readConfig, readHosts, writeConfig } from "../config/config"
import { forgetToken, readToken, type Storage, saveToken } from "../config/secrets"
import { openOrPrint } from "../io/browser"
import { CliError, cliError, notLoggedIn, usageError } from "../output/errors"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"
import { VERSION } from "../version"

const clientName = () =>
  `intesa-cli on ${hostname()} (${process.platform}-${process.arch})`.slice(0, 100)

// Sign-in flows pick their credentials explicitly: a stale stored token must not be sent
// along, since a bearer header wins over the session cookie on the server.
const httpFor = (ctx: Ctx, host: string, token?: string) =>
  createHttp({
    host,
    token,
    dryRun: ctx.globals.dryRun,
    debug: debugLevel(ctx.env, ctx.globals.debug),
    stdout: ctx.stdout,
    stderr: ctx.stderr,
    timeoutMs: timeoutMs(ctx.env),
  })

const majorOf = (version: unknown) => {
  const major = /^(\d+)\./.exec(String(version))?.[1]
  return major === undefined ? undefined : Number(major)
}

// A server of another major version may have changed the API under this CLI. Asked on login
// and status only, and never an error: an older server that does not say, or a failed
// request, just means no warning.
async function warnOnVersionMismatch(ctx: Ctx, host: string) {
  try {
    const { version } = await (await httpFor(ctx, host).client.api.health.$get()).json()
    const [ours, theirs] = [majorOf(VERSION), majorOf(version)]
    if (ours === undefined || theirs === undefined || ours === theirs) return
    ctx.stderr(
      `! intesa ${ours}.x is talking to a ${theirs}.x server; ${
        theirs > ours
          ? `update with \`curl -fsSL ${host}/cli/intesa.js -o intesa.js\``
          : "this intesa is newer than the server, so some commands may fail"
      }\n`,
    )
  } catch {}
}

const loggedOut = (host: string) => notLoggedIn(`not logged in to ${host}`)

// What `auth status` prints; also `auth login --json`.
async function describeLogin(ctx: Ctx, host: string, token: string, storage: Storage) {
  const { client } = httpFor(ctx, host, token)
  const [me, list] = await Promise.all([client.api.me.$get(), client.api.me.tokens.$get()])
  const { user } = await me.json()
  const current = (await list.json()).tokens.find((t) => t.current)
  return {
    host,
    user: user.email,
    name: user.name,
    userId: user.id,
    tokenId: current?.id ?? null,
    tokenName: current?.name ?? null,
    kind: current?.kind ?? null,
    scope: current?.scope ?? null,
    expiresAt: current?.expiresAt ?? null,
    lastUsedAt: current?.lastUsedAt ?? null,
    storage,
    totpEnabled: user.totpEnabled,
  }
}

type Issued = {
  token: string
  user: { email: string; name: string }
  tokenId?: string
  kind?: "cli" | "pat"
  scope?: "read" | "write"
}

// The RFC 8628 shape: show a code, let the person approve it in the web app (where Google
// sign-in and 2FA already happen), poll until they do.
async function deviceLogin(ctx: Ctx, http: Http, browser: boolean): Promise<Issued> {
  const res = await http.client.api.auth.device.$post({ json: { clientName: clientName() } })
  const start = await res.json()
  const url = start.verificationUriComplete
  ctx.stderr(`! First copy your one-time code: ${start.userCode}\n`)
  if (browser) openOrPrint(ctx, url, " to approve this sign-in")
  else ctx.stderr(`Open ${url} in your browser to approve this sign-in.\n`)
  ctx.stderr("Waiting for approval…\n")

  // INTESA_DEVICE_POLL_MS replaces the server's interval and its slow_down step (tests).
  const fast = Number(ctx.env.INTESA_DEVICE_POLL_MS)
  const step = fast > 0 ? fast : 5000
  let wait = fast > 0 ? fast : start.interval * 1000
  const deadline = Date.now() + start.expiresIn * 1000
  const expired = () =>
    cliError(
      "DEVICE_CODE_EXPIRED",
      "the sign-in request expired before it was approved",
      "Run `intesa auth login` again.",
    )
  for (;;) {
    await Bun.sleep(wait)
    if (Date.now() >= deadline) throw expired()
    const poll = await (
      await http.client.api.auth.device.token.$post({ json: { deviceCode: start.deviceCode } })
    ).json()
    if (poll.status === "approved") {
      const { token, user, tokenId } = poll
      return { token, user, tokenId, kind: "cli", scope: "write" }
    }
    if (poll.status === "denied") {
      throw cliError("ACCESS_DENIED", "the sign-in request was denied")
    }
    if (poll.status === "expired") throw expired()
    if (poll.status === "slow_down") wait += step
  }
}

// Development servers only: dev-login gives a cookie, which mints one token and is dropped.
async function devLogin(http: Http, email: string): Promise<Issued> {
  const { client } = http
  if (!(await (await client.api.auth.config.$get()).json()).devLogin) {
    throw usageError(`${http.host} does not offer dev sign-in`, "Run `intesa auth login` instead.")
  }
  const res = await client.api.auth["dev-login"].$post({ json: { email } })
  const body = await res.json()
  if (!("user" in body)) {
    throw new CliError("this account uses two-factor sign-in, which dev sign-in cannot complete", {
      code: "TWO_FACTOR_REQUIRED",
      exitCode: 4,
      hint: "Run `intesa auth login` without --dev.",
    })
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")
  const headers = { cookie }
  const created = await (
    await client.api.me.tokens.$post({ json: { name: clientName(), scope: "write" } }, { headers })
  ).json()
  await client.api.auth.logout.$post({}, { headers }).catch(() => {})
  return {
    token: created.token,
    user: body.user,
    tokenId: created.id,
    kind: created.kind,
    scope: created.scope,
  }
}

async function tokenFromStdin(ctx: Ctx, host: string): Promise<Issued> {
  const token = (await ctx.readStdin()).split(/\r?\n/)[0]?.trim()
  if (!token) {
    throw usageError(
      "--with-token reads the token from stdin, which was empty",
      "e.g. `intesa auth login --with-token < token.txt`",
    )
  }
  const { client } = httpFor(ctx, host, token)
  const { user } = await (await client.api.me.$get()).json()
  const current = (await (await client.api.me.tokens.$get()).json()).tokens.find((t) => t.current)
  return { token, user, tokenId: current?.id, kind: current?.kind, scope: current?.scope }
}

// A user with a single workspace never has to pick one: it becomes the default, unless the
// config already names one. The slug's id is cached either way it is known.
async function rememberWorkspace(ctx: Ctx, host: string, token: string, previousUser?: string) {
  const { client } = httpFor(ctx, host, token)
  const { workspaces } = await (await client.api.workspaces.$get()).json()
  const [only] = workspaces
  const user = readHosts(ctx.configDir)[host]?.user
  if (workspaces.length === 1 && only) cacheWorkspace(ctx.configDir, host, only)
  else if (previousUser !== user) cacheWorkspace(ctx.configDir, host, undefined)
  const config = readConfig(ctx.configDir)
  if (workspaces.length === 1 && only && !config.workspace) {
    writeConfig(ctx.configDir, { ...config, workspace: only.slug })
    ctx.done(`Default workspace set to ${only.slug}`)
  }
}

const login = defineCommand({
  name: "login",
  summary: "Sign in to an Intesa server",
  description: [
    "Sign in to an Intesa server.",
    "",
    "By default this shows a one-time code and opens the server's device page, where you",
    "approve the sign-in with your normal web login (Google sign-in and two-factor included).",
    "This also works over SSH: open the link on any machine.",
    "",
    "--with-token reads an existing token (e.g. one from `intesa token create`) from stdin.",
    "--dev signs in by email on development servers that allow it.",
    "",
    "The token is kept in the system keychain, or in hosts.json in the config directory when",
    "the keychain is unavailable or --insecure-storage is given.",
  ].join("\n"),
  flags: z.object({
    browser: z.boolean().default(true).meta({ description: "Do not open the browser" }),
    withToken: z.boolean().default(false).meta({ description: "Read a token from stdin" }),
    dev: z
      .boolean()
      .default(false)
      .meta({ description: "Sign in with dev-login (development servers only)" }),
    email: z.string().optional().meta({ placeholder: "email", description: "Email for --dev" }),
    insecureStorage: z
      .boolean()
      .default(false)
      .meta({ description: "Store the token in a plain file instead of the system keychain" }),
  }),
  output: "authStatus",
  examples: [
    "intesa auth login --host https://pm.example.com",
    "intesa auth login --with-token < token.txt",
    "intesa auth login --dev --email me@example.com",
  ],
  async run(ctx, _args, flags) {
    const host = ctx.context().host?.value
    if (!host) {
      throw usageError(
        "no server to sign in to: pass --host URL or set INTESA_HOST",
        "e.g. `intesa auth login --host https://pm.example.com`",
      )
    }
    if (flags.withToken && flags.dev) throw usageError("--with-token and --dev cannot be combined")
    if (flags.dev && !flags.email) throw usageError("--dev needs --email")

    const anonymous = httpFor(ctx, host)
    const issued = flags.withToken
      ? await tokenFromStdin(ctx, host)
      : flags.dev && flags.email
        ? await devLogin(anonymous, flags.email)
        : await deviceLogin(ctx, anonymous, flags.browser)

    if (ctx.globals.dryRun) {
      const { token: _, ...signedIn } = issued
      dryRunWrite(ctx, join(ctx.configDir, "hosts.json"), { [host]: signedIn })
    }
    const previousUser = readHosts(ctx.configDir)[host]?.user
    const storage = await saveToken(
      ctx.configDir,
      host,
      issued.token,
      { user: issued.user.email, tokenId: issued.tokenId, kind: issued.kind, scope: issued.scope },
      {
        env: ctx.env,
        insecure: flags.insecureStorage,
        warn: (message) => ctx.stderr(`! ${message}\n`),
      },
    )
    ctx.done(`Logged in to ${host} as ${issued.user.name} (${issued.user.email})`)
    await rememberWorkspace(ctx, host, issued.token, previousUser)
    if (ctx.env.INTESA_TOKEN) {
      ctx.stderr("! INTESA_TOKEN is set, and is used instead of the stored token\n")
    }
    await warnOnVersionMismatch(ctx, host)
    // The status costs two more requests, so only when it is asked for.
    if (ctx.globals.json || ctx.globals.fields !== undefined) {
      return describeLogin(ctx, host, issued.token, storage)
    }
  },
})

const logout = defineCommand({
  name: "logout",
  summary: "Sign out and revoke the stored token",
  description:
    "Revoke the stored token on the server, then forget it. A token the server no longer\n" +
    "accepts is forgotten all the same. INTESA_TOKEN is not affected.",
  examples: ["intesa auth logout", "intesa auth logout --host https://pm.example.com"],
  async run(ctx) {
    const host = requireHost(ctx.context())
    const stored = await readToken(ctx.configDir, host, { ...ctx.env, INTESA_TOKEN: undefined })
    if (!stored && !readHosts(ctx.configDir)[host]) throw loggedOut(host)
    if (stored) {
      try {
        await httpFor(ctx, host, stored.token).client.api.me.tokens.current.$delete()
      } catch (err) {
        if (!(err instanceof CliError) || err.exitCode !== 4) throw err
        ctx.stderr("! The server no longer accepted the token\n")
      }
    }
    if (ctx.globals.dryRun) throw new DryRunDone()
    await forgetToken(ctx.configDir, host, ctx.env)
    ctx.done(`Logged out of ${host}`)
    if (ctx.env.INTESA_TOKEN) ctx.stderr("! INTESA_TOKEN is still set\n")
  },
})

const status = defineCommand({
  name: "status",
  summary: "Show who you are signed in as",
  description:
    "Show the server, the signed-in user, the token's kind, scope and expiry, where the token\n" +
    "is stored (keychain, file or env) and whether two-factor sign-in is on. Exits 4 when not\n" +
    "signed in or when the token no longer works.",
  output: "authStatus",
  examples: ["intesa auth status", "intesa auth status --json --fields user,scope"],
  async run(ctx) {
    const host = requireHost(ctx.context())
    const credentials = await readToken(ctx.configDir, host, ctx.env)
    if (!credentials) throw loggedOut(host)
    const described = await describeLogin(ctx, host, credentials.token, credentials.storage)
    await warnOnVersionMismatch(ctx, host)
    return described
  },
})

const token = defineCommand({
  name: "token",
  summary: "Print the active token",
  description: "Print the token intesa uses for the server, for piping into other tools.",
  output: "authToken",
  examples: ["intesa auth token", 'curl -H "Authorization: Bearer $(intesa auth token)" …'],
  async run(ctx) {
    const host = requireHost(ctx.context())
    const credentials = await readToken(ctx.configDir, host, ctx.env)
    if (!credentials) throw loggedOut(host)
    return { token: credentials.token }
  },
  human: (_ctx, { token }) => `${token}\n`,
})

export default defineGroup({
  name: "auth",
  summary: "Sign in to and out of Intesa servers",
  commands: [login, logout, status, token],
  examples: ["intesa auth login --host https://pm.example.com", "intesa auth status"],
})
