import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { MutationErrorNotice } from "@/components/mutation-error-notice"
import { Message, RouteError } from "@/components/page"
import { buttonClass } from "@/components/ui/button"
import { themeInitScript } from "@/lib/theme"
import appCss from "../styles.css?url"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Intesa" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    scripts: [{ children: themeInitScript }],
  }),
  component: RootComponent,
  notFoundComponent: () => (
    <Message title="Page not found." body="That address doesn't lead anywhere.">
      <Link to="/" className={buttonClass("outline")}>
        Go home
      </Link>
    </Message>
  ),
  errorComponent: RouteError,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <MutationErrorNotice />
      </QueryClientProvider>
    </RootDocument>
  )
}

// The theme script sets the class before paint; React must not reset it on hydration.
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
