export type User = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  totpEnabled: boolean
}

export type Workspace = { id: string; name: string; slug: string; role: "owner" | "member" }

export type AuthConfig = { google: boolean; devLogin: boolean }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.code ?? "UNKNOWN",
      data?.message ?? `Request failed (${res.status})`,
    )
  }
  return data as T
}

export const api = {
  authConfig: () => request<AuthConfig>("GET", "/auth/config"),
  devLogin: (input: { email: string; name?: string }) =>
    request<{ user: User } | { twoFactorRequired: true }>("POST", "/auth/dev-login", input),
  verify2fa: (code: string) => request<{ user: User }>("POST", "/auth/2fa", { code }),
  logout: () => request<void>("POST", "/auth/logout"),

  me: () => request<{ user: User }>("GET", "/me"),
  updateMe: (input: { name: string }) => request<{ user: User }>("PATCH", "/me", input),
  setup2fa: () => request<{ secret: string; otpauthUrl: string }>("POST", "/me/2fa/setup"),
  enable2fa: (code: string) => request<{ user: User }>("POST", "/me/2fa/enable", { code }),
  disable2fa: (code: string) => request<{ user: User }>("POST", "/me/2fa/disable", { code }),

  workspaces: () => request<{ workspaces: Workspace[] }>("GET", "/workspaces"),
  createWorkspace: (input: { name: string; slug?: string }) =>
    request<{ workspace: Workspace }>("POST", "/workspaces", input),
}

export const keys = {
  me: ["me"] as const,
  workspaces: ["workspaces"] as const,
  authConfig: ["auth-config"] as const,
}
