import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  })
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
  })
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Breadcrumb label for the page. */
    title?: string
    /** Page owns the whole main area and scrolls internally. */
    fullBleed?: boolean
  }

  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
