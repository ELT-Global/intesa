import type { ErrorHandler } from "hono"
import { HTTPException } from "hono/http-exception"

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "TWO_FACTOR_REQUIRED"
  | "INTERNAL"

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 500> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  TWO_FACTOR_REQUIRED: 401,
  INTERNAL: 500,
}

export class ApiError extends Error {
  readonly status: (typeof STATUS)[ErrorCode]
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.status = STATUS[code]
  }
}

export const onError: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) {
    return c.json({ code: err.code, message: err.message }, err.status)
  }
  // Framework-raised errors (e.g. malformed JSON body) carry a safe status.
  if (err instanceof HTTPException && err.status < 500) {
    const code: ErrorCode = err.status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR"
    return c.json({ code, message: err.message }, err.status)
  }
  // Stack and details stay in server logs only.
  console.error(JSON.stringify({ level: "error", msg: "unhandled", error: String(err) }))
  return c.json({ code: "INTERNAL", message: "Internal server error" }, 500)
}
