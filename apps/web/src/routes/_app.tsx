import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useEffect } from "react"
import { StatusChangeProvider } from "@/components/tasks/use-status-change"
import { ApiError } from "@/lib/api"
import { preloadEditorWhenIdle } from "@/lib/preload-editor"
import { meQuery } from "@/lib/queries"
import { rememberReturnPath, takeReturnPath } from "@/lib/sign-in-return"

// Everything behind sign-in hangs off this pathless layout.
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location, preload }) => {
    try {
      await context.queryClient.fetchQuery(meQuery)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        if (!preload) rememberReturnPath(location.pathname + location.searchStr)
        throw redirect({ to: err.code === "TWO_FACTOR_REQUIRED" ? "/login/2fa" : "/login" })
      }
      throw err
    }
    // A hovered link is not a visit, so it must not use up the remembered destination.
    if (preload) return
    // Every sign-in path (dev form, 2FA, Google) ends on "/", which is where a remembered
    // destination such as the CLI's /device link is picked up. Any other signed-in page
    // forgets it, so it cannot redirect a later visit to "/".
    const next = takeReturnPath()
    if (next && location.pathname === "/") throw redirect({ href: next })
  },
  component: AppLayout,
})

function AppLayout() {
  useEffect(preloadEditorWhenIdle, [])
  return (
    <StatusChangeProvider>
      <Outlet />
    </StatusChangeProvider>
  )
}
