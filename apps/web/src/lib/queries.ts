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
