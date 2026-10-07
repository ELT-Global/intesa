import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useEffect } from "react"
import { ApiError } from "@/lib/api"
import { preloadEditorWhenIdle } from "@/lib/preload-editor"
import { meQuery } from "@/lib/queries"

// Everything behind sign-in hangs off this pathless layout.
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.fetchQuery(meQuery)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw redirect({ to: err.code === "TWO_FACTOR_REQUIRED" ? "/login/2fa" : "/login" })
      }
      throw err
    }
  },
  component: AppLayout,
})

function AppLayout() {
  useEffect(preloadEditorWhenIdle, [])
  return <Outlet />
}
