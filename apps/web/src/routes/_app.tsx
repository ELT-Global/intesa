import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useEffect } from "react"
import { ApiError } from "@/lib/api"
import { preloadEditorWhenIdle } from "@/lib/preload-editor"
import { meQuery } from "@/lib/queries"
import { rememberReturnPath, takeReturnPath } from "@/lib/sign-in-return"

// Everything behind sign-in hangs off this pathless layout.
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.fetchQuery(meQuery)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        rememberReturnPath(location.pathname + location.searchStr)
        throw redirect({ to: err.code === "TWO_FACTOR_REQUIRED" ? "/login/2fa" : "/login" })
      }
      throw err
    }
    // Every sign-in path (dev form, 2FA, Google) ends on "/", which is where a remembered
    // destination such as the CLI's /device link is picked up.
    if (location.pathname === "/") {
      const next = takeReturnPath()
      if (next) throw redirect({ href: next })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  useEffect(preloadEditorWhenIdle, [])
  return <Outlet />
}
