import { queryOptions } from "@tanstack/react-query"
import { api, keys } from "./api"

export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: async () => (await api.me()).user,
})

export const workspacesQuery = queryOptions({
  queryKey: keys.workspaces,
  queryFn: async () => (await api.workspaces()).workspaces,
})

export const authConfigQuery = queryOptions({
  queryKey: keys.authConfig,
  queryFn: api.authConfig,
  staleTime: Infinity,
})

export const projectsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: keys.projects(workspaceId),
    queryFn: async () => (await api.projects(workspaceId)).projects,
  })

export const projectQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.project(projectId),
    queryFn: async () => (await api.project(projectId)).project,
  })

export const membersQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: keys.members(workspaceId),
    queryFn: async () => (await api.members(workspaceId)).members,
  })

export const homeQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: keys.home(workspaceId),
    queryFn: () => api.home(workspaceId),
    staleTime: 0,
  })
