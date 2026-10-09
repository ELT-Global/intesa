import type { AppType } from "@intesa/api"
import { hc } from "hono/client"
import { apiError, cliError } from "../output/errors"
import { toJson } from "../output/json"
import { USER_AGENT } from "../version"

export type DebugLevel = "off" | "requests" | "api"

export function debugLevel(env: Record<string, string | undefined>, flag: boolean): DebugLevel {
  if (env.INTESA_DEBUG === "api") return "api"
  if (flag || (env.INTESA_DEBUG && env.INTESA_DEBUG !== "0")) return "requests"
  return "off"
}

// How long one attempt may take; INTESA_HTTP_TIMEOUT_MS changes it.
export function timeoutMs(env: Record<string, string | undefined>): number {
  const ms = Number(env.INTESA_HTTP_TIMEOUT_MS)
  return ms > 0 ? ms : 30_000
}

// Thrown after --dry-run prints a mutation; main treats it as success.
export class DryRunDone extends Error {}

// --dry-run for a local file: shown like a request, and nothing is written.
export function dryRunWrite(
  ctx: { stdout: (text: string) => void },
  path: string,
  body: unknown,
): never {
  ctx.stdout(toJson({ method: "WRITE", path, body }))
  throw new DryRunDone()
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"])
const RETRY_DELAYS_MS = [200, 600]
const SECRET_HEADERS = new Set(["authorization", "cookie", "set-cookie"])
// Body keys that hold credentials: tokens, device codes and (sent) authenticator codes. A
// response's `code` is an error code, which a debug log should show.
const SECRET_SENT = new Set(["token", "deviceCode", "code"])
const SECRET_RECEIVED = new Set(["token", "deviceCode"])

const redact = (name: string, value: string) => {
  if (!SECRET_HEADERS.has(name.toLowerCase())) return value
  const scheme = /^(Bearer|Basic)\s/i.exec(value)?.[1]
  return scheme ? `${scheme} [redacted]` : "[redacted]"
}

function redactBody(value: unknown, secret: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => redactBody(v, secret))
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      secret.has(k) && typeof v === "string" ? "[redacted]" : redactBody(v, secret),
    ]),
  )
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function describeBody(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? ""
  if (type.includes("multipart/form-data")) {
    const form = await req.formData()
    return Object.fromEntries(
      [...form.entries()].map(([k, v]) =>
        typeof v === "string" ? [k, v] : [k, { name: v.name, size: v.size, type: v.type }],
      ),
    )
  }
  const text = await req.text()
  return text ? parsed(text) : null
}

type Options = {
  host: string
  token?: string
  dryRun: boolean
  debug: DebugLevel
  stdout: (text: string) => void
  stderr: (text: string) => void
  fetch?: typeof fetch
  // Per attempt (default 30 s).
  timeoutMs?: number
  // Whether failed reads are tried again (default true).
  retry?: boolean
}

export function createHttp(opts: Options) {
  const base = opts.fetch ?? fetch
  const log = (line: string) => opts.stderr(`${line}\n`)
  const timeout = opts.timeoutMs ?? 30_000

  async function send(req: Request, attempt: number): Promise<Response> {
    const started = performance.now()
    if (opts.debug !== "off") {
      log(`> ${req.method} ${req.url}`)
      if (opts.debug === "api") {
        for (const [k, v] of req.headers) log(`> ${k}: ${redact(k, v)}`)
        if (req.body) {
          log(
            `> ${JSON.stringify(redactBody(await describeBody(req.clone() as Request), SECRET_SENT))}`,
          )
        }
      }
    }
    const res = await base(new Request(req, { signal: AbortSignal.timeout(timeout) }))
    if (opts.debug !== "off") {
      const ms = Math.round(performance.now() - started)
      log(`< ${res.status} ${res.statusText} (${ms} ms${attempt ? `, retry ${attempt}` : ""})`)
      if (opts.debug === "api") {
        for (const [k, v] of res.headers) log(`< ${k}: ${redact(k, v)}`)
        const body = redactBody(parsed(await res.clone().text()), SECRET_RECEIVED)
        log(`< ${typeof body === "string" ? body : JSON.stringify(body)}`)
      }
    }
    return res
  }

  // Every request goes through here: auth, User-Agent, --dry-run, debug logging, timeouts,
  // retries and error mapping. Non-2xx responses throw a CliError, so callers only see
  // successes.
  async function request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const req =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init)
    if (!req.headers.has("user-agent")) req.headers.set("user-agent", USER_AGENT)
    if (opts.token && !req.headers.has("authorization")) {
      req.headers.set("authorization", `Bearer ${opts.token}`)
    }
    const safe = SAFE.has(req.method)
    if (opts.dryRun && !safe) {
      const url = new URL(req.url)
      opts.stdout(
        toJson({
          method: req.method,
          path: url.pathname + url.search,
          body: await describeBody(req),
        }),
      )
      throw new DryRunDone()
    }

    // Reads are idempotent, so transient failures are retried; writes never are, since a
    // lost response does not mean the write did not happen.
    for (let attempt = 0; ; attempt++) {
      const retry = safe && opts.retry !== false && attempt < RETRY_DELAYS_MS.length
      let res: Response
      try {
        res = await send(safe ? (req.clone() as Request) : req, attempt)
      } catch (err) {
        if (retry) {
          await Bun.sleep(RETRY_DELAYS_MS[attempt] ?? 0)
          continue
        }
        const reason =
          (err as Error).name === "TimeoutError"
            ? `no answer within ${timeout / 1000} s`
            : (err as Error).message
        throw cliError("NETWORK_ERROR", `could not reach ${opts.host}: ${reason}`)
      }
      if (res.status >= 500 && retry) {
        await Bun.sleep(RETRY_DELAYS_MS[attempt] ?? 0)
        continue
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw apiError(res.status, body, Boolean(opts.token))
      }
      return res
    }
  }

  return {
    host: opts.host,
    hasToken: Boolean(opts.token),
    // Raw requests (`intesa api`, uploads, downloads), with the same handling as `client`.
    request,
    // The typed client the web uses: `await (await http.client.api.me.$get()).json()`.
    client: hc<AppType>(opts.host, { fetch: request as typeof fetch }),
  }
}

export type Http = ReturnType<typeof createHttp>
