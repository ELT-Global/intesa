// Constants and request schemas shared with clients (the CLI imports this as
// @intesa/api/schemas). Only zod may be imported here, directly or through the modules
// re-exported, so a client bundle never pulls in the database driver or the server.
export * from "./tasks/schemas"

export const TAG_COLORS = ["blue", "orange", "aqua", "violet", "magenta", "gray"] as const
export type TagColor = (typeof TAG_COLORS)[number]

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,4}$/
// A task's key is its project key and number (WEB-12); people type it in any case.
export const TASK_KEY_PATTERN = /^([A-Z][A-Z0-9]{1,4})-([1-9]\d{0,8})$/i

// cli tokens come from the device sign-in flow, pat tokens are created by hand.
export const TOKEN_KINDS = ["cli", "pat"] as const
export const TOKEN_SCOPES = ["read", "write"] as const
export type TokenKind = (typeof TOKEN_KINDS)[number]
export type TokenScope = (typeof TOKEN_SCOPES)[number]
