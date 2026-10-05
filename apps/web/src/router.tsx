import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { RouteError } from "./components/page"
import { ApiError } from "./lib/api"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Client errors will not change on retry; only transient failures are worth one more go.
        retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status < 500),
        retryDelay: 300,
      },
    },
  })
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultErrorComponent: RouteError,
    // Avoid a flash of skeleton for fast loads, and avoid flicker once it shows.
    defaultPendingMs: 150,
    defaultPendingMinMs: 250,
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
