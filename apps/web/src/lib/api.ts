import type { AppType } from "@intesa/api"
import { hc, type InferResponseType } from "hono/client"

// Same-origin: Vite proxies /api in dev, Hono serves it in production.
export const client = hc<AppType>("/", { init: { credentials: "same-origin" } })

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Resolves to the typed JSON body, or throws an ApiError built from the `{code,message}` envelope. */
type Res = { ok: boolean; status: number; json(): Promise<unknown> }

export async function unwrap<R extends Res>(
  res: Promise<R>,
): Promise<Awaited<ReturnType<R["json"]>>> {
  const r = await res
  if (r.status === 204) return undefined as never
  const data = (await r.json().catch(() => null)) as { code?: string; message?: string } | null
  if (!r.ok) {
    throw new ApiError(
      r.status,
      data?.code ?? "UNKNOWN",
      data?.message ?? `Request failed (${r.status})`,
    )
  }
  return data as never
}

export type User = InferResponseType<typeof client.api.me.$get>["user"]
export type Workspace = InferResponseType<typeof client.api.workspaces.$get>["workspaces"][number]
export type AuthConfig = InferResponseType<(typeof client.api.auth.config)["$get"]>

export type Project = InferResponseType<
  (typeof client.api.projects)[":projectId"]["$get"]
>["project"]

const workspaceApi = client.api.workspaces[":workspaceId"]
const memberApi = workspaceApi.members[":memberId"]
export type Member = InferResponseType<typeof workspaceApi.members.$get>["members"][number]
export type MemberRole = Member["role"]
export type HomeData = InferResponseType<typeof workspaceApi.home.$get>

export const api = {
  members: (workspaceId: string) => unwrap(workspaceApi.members.$get({ param: { workspaceId } })),
  addMember: (workspaceId: string, json: { email: string; role: MemberRole }) =>
    unwrap(workspaceApi.members.$post({ param: { workspaceId }, json })),
  changeRole: (workspaceId: string, memberId: string, role: MemberRole) =>
    unwrap(memberApi.$patch({ param: { workspaceId, memberId }, json: { role } })),
  removeMember: (workspaceId: string, memberId: string) =>
    unwrap(memberApi.$delete({ param: { workspaceId, memberId } })),
  home: (workspaceId: string) => unwrap(workspaceApi.home.$get({ param: { workspaceId } })),

  projects: (workspaceId: string) =>
    unwrap(client.api.workspaces[":workspaceId"].projects.$get({ param: { workspaceId } })),
  createProject: (
    workspaceId: string,
    json: { name: string; key?: string; description?: string },
  ) =>
    unwrap(client.api.workspaces[":workspaceId"].projects.$post({ param: { workspaceId }, json })),
  project: (projectId: string) =>
    unwrap(client.api.projects[":projectId"].$get({ param: { projectId } })),
  updateProject: (projectId: string, json: { name?: string; description?: string | null }) =>
    unwrap(client.api.projects[":projectId"].$patch({ param: { projectId }, json })),
  deleteProject: (projectId: string) =>
    unwrap(client.api.projects[":projectId"].$delete({ param: { projectId } })),

  authConfig: () => unwrap(client.api.auth.config.$get()),
  devLogin: (json: { email: string; name?: string }) =>
    unwrap(client.api.auth["dev-login"].$post({ json })),
  verify2fa: (code: string) => unwrap(client.api.auth["2fa"].$post({ json: { code } })),
  logout: () => unwrap(client.api.auth.logout.$post()),

  me: () => unwrap(client.api.me.$get()),
  updateMe: (json: { name: string }) => unwrap(client.api.me.$patch({ json })),
  setup2fa: () => unwrap(client.api.me["2fa"].setup.$post()),
  enable2fa: (code: string) => unwrap(client.api.me["2fa"].enable.$post({ json: { code } })),
  disable2fa: (code: string) => unwrap(client.api.me["2fa"].disable.$post({ json: { code } })),

  workspaces: () => unwrap(client.api.workspaces.$get()),
  createWorkspace: (json: { name: string; slug?: string }) =>
    unwrap(client.api.workspaces.$post({ json })),
}

export const keys = {
  me: ["me"] as const,
  workspaces: ["workspaces"] as const,
  authConfig: ["auth-config"] as const,
  projects: (workspaceId: string) => ["workspaces", workspaceId, "projects"] as const,
  // Prefix of the task keys, so invalidating it also covers a project's tasks.
  project: (projectId: string) => ["projects", projectId] as const,
  members: (workspaceId: string) => ["workspaces", workspaceId, "members"] as const,
  home: (workspaceId: string) => ["workspaces", workspaceId, "home"] as const,
}
