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

// API error codes (see the server's `{code, message}` envelope) and their exit codes.
const API_EXIT: Record<string, ExitCode> = {
  UNAUTHORIZED: 4,
  TWO_FACTOR_REQUIRED: 4,
  NOT_FOUND: 5,
  CONFLICT: 6,
  FORBIDDEN: 7,
  VALIDATION_ERROR: 8,
}

export class CliError extends Error {
  readonly code: string
  readonly exitCode: ExitCode
  readonly hint?: string
  constructor(message: string, opts: { code: string; exitCode: ExitCode; hint?: string }) {
    super(message)
    this.code = opts.code
    this.exitCode = opts.exitCode
    this.hint = opts.hint
  }

  toJSON() {
    return { code: this.code, message: this.message, exitCode: this.exitCode, hint: this.hint }
  }
}

export const usageError = (message: string, hint?: string) =>
  new CliError(message, { code: "USAGE_ERROR", exitCode: 2, hint })

export const LOGIN_HINT = "Run `intesa auth login` to sign in."

export function apiError(status: number, body: unknown, hasToken: boolean): CliError {
  const env = (body ?? {}) as { code?: unknown; message?: unknown }
  const code = typeof env.code === "string" ? env.code : status >= 500 ? "INTERNAL" : "HTTP_ERROR"
  const message = typeof env.message === "string" ? env.message : `HTTP ${status}`
  const exitCode = API_EXIT[code] ?? (status === 404 ? 5 : 1)
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
