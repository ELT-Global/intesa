export const EXIT_CODES = [
  { code: 0, name: "OK", meaning: "Success" },
  { code: 1, name: "ERROR", meaning: "Unexpected error: network, server error, rate limited" },
  {
    code: 2,
    name: "USAGE",
    meaning: "Bad flags or arguments, missing input when not interactive, ambiguous name",
  },
  { code: 3, name: "CANCELLED", meaning: "Cancelled: prompt aborted or Ctrl+C" },
  {
    code: 4,
    name: "AUTH",
    meaning: "Not logged in, token expired or revoked, two-factor required",
  },
  { code: 5, name: "NOT_FOUND", meaning: "The resource does not exist or is not visible to you" },
  { code: 6, name: "CONFLICT", meaning: "Conflicts with the current state, e.g. a taken name" },
  { code: 7, name: "FORBIDDEN", meaning: "Not allowed, including writes with a read-only token" },
  { code: 8, name: "VALIDATION", meaning: "The server rejected the input" },
] as const

export type ExitCode = (typeof EXIT_CODES)[number]["code"]

type Source = "server" | "cli"

// Every `code` an error can carry: the API's (from its `{code, message}` envelope) and the
// CLI's own. `intesa schema` lists them.
export const ERROR_CODES = [
  { code: "UNAUTHORIZED", exitCode: 4, source: "server", meaning: "No valid token was sent" },
  { code: "TWO_FACTOR_REQUIRED", exitCode: 4, source: "server", meaning: "Two-factor sign-in" },
  { code: "NOT_FOUND", exitCode: 5, source: "server", meaning: "No such thing, or not yours" },
  { code: "CONFLICT", exitCode: 6, source: "server", meaning: "Conflicts with current state" },
  { code: "FORBIDDEN", exitCode: 7, source: "server", meaning: "Not allowed" },
  { code: "VALIDATION_ERROR", exitCode: 8, source: "server", meaning: "Invalid input" },
  { code: "RATE_LIMITED", exitCode: 1, source: "server", meaning: "Too many requests" },
  { code: "INTERNAL", exitCode: 1, source: "server", meaning: "A server error, or a CLI bug" },
  { code: "HTTP_ERROR", exitCode: 1, source: "cli", meaning: "Any other HTTP error status" },
  { code: "NETWORK_ERROR", exitCode: 1, source: "cli", meaning: "Unreachable or timed out" },
  { code: "CONFIG_ERROR", exitCode: 1, source: "cli", meaning: "A config file is invalid" },
  { code: "EDITOR_ERROR", exitCode: 1, source: "cli", meaning: "The editor failed" },
  { code: "USAGE_ERROR", exitCode: 2, source: "cli", meaning: "Bad flags, arguments or input" },
  { code: "CANCELLED", exitCode: 3, source: "cli", meaning: "A prompt was cancelled" },
  { code: "NOT_LOGGED_IN", exitCode: 4, source: "cli", meaning: "No server or credentials" },
  { code: "ACCESS_DENIED", exitCode: 4, source: "cli", meaning: "Sign-in was denied" },
  { code: "DEVICE_CODE_EXPIRED", exitCode: 4, source: "cli", meaning: "Sign-in timed out" },
] as const satisfies { code: string; exitCode: ExitCode; source: Source; meaning: string }[]

export type ErrorCode = (typeof ERROR_CODES)[number]["code"]

const exitCodeOf = (code: string) => ERROR_CODES.find((e) => e.code === code)?.exitCode

export class CliError extends Error {
  readonly code: string
  readonly exitCode: ExitCode
  readonly hint?: string
  // What did succeed before the failure; printed like a normal result, then the error.
  readonly result?: unknown
  constructor(
    message: string,
    opts: { code: string; exitCode: ExitCode; hint?: string; result?: unknown },
  ) {
    super(message)
    this.code = opts.code
    this.exitCode = opts.exitCode
    this.hint = opts.hint
    this.result = opts.result
  }

  toJSON() {
    return { code: this.code, message: this.message, exitCode: this.exitCode, hint: this.hint }
  }
}

// An error with one of the CLI's own codes; the exit code follows from it.
export const cliError = (code: ErrorCode, message: string, hint?: string) =>
  new CliError(message, { code, exitCode: exitCodeOf(code) ?? 1, hint })

export const usageError = (message: string, hint?: string) => cliError("USAGE_ERROR", message, hint)
export const notFound = (message: string, hint?: string) => cliError("NOT_FOUND", message, hint)
// Local checks that mirror the server's rules fail like the server would (exit 8).
export const invalid = (message: string) => cliError("VALIDATION_ERROR", message)
export const cancelled = () => cliError("CANCELLED", "cancelled")

export const LOGIN_HINT = "Run `intesa auth login` to sign in."

export const notLoggedIn = (message: string, hint = LOGIN_HINT) =>
  cliError("NOT_LOGGED_IN", message, hint)

// The same failure, naming what it was about: "notes.md: …".
export const prefixed = (name: string, err: CliError) =>
  new CliError(`${name}: ${err.message}`, {
    code: err.code,
    exitCode: err.exitCode,
    hint: err.hint,
  })

export function apiError(status: number, body: unknown, hasToken: boolean): CliError {
  const env = (body ?? {}) as { code?: unknown; message?: unknown }
  const code = typeof env.code === "string" ? env.code : status >= 500 ? "INTERNAL" : "HTTP_ERROR"
  const message = typeof env.message === "string" ? env.message : `HTTP ${status}`
  const known = ERROR_CODES.find((e) => e.code === code && e.source === "server")
  const exitCode = known?.exitCode ?? (status === 404 ? 5 : 1)
  let hint: string | undefined
  if (code === "UNAUTHORIZED") {
    hint = hasToken ? `Your token may be expired or revoked. ${LOGIN_HINT}` : LOGIN_HINT
  }
  return new CliError(message, { code, exitCode, hint })
}

// Written to stderr. With --json agents get one parseable line instead of prose.
export function formatError(err: CliError, json: boolean): string {
  if (json) return `${JSON.stringify({ error: err.toJSON() })}\n`
  return `error: ${err.message}\n${err.hint ? `${err.hint}\n` : ""}`
}
