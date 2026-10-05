import { useRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api"

/** Full-screen centred message, used for 404 and error states. */
export function Message({
  title,
  body,
  children,
}: {
  title: string
  body?: string
  children?: ReactNode
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-medium tracking-[-0.025em]">{title}</h1>
      {body && <p className="max-w-sm text-sm text-muted-foreground">{body}</p>}
      {children && <div className="mt-3">{children}</div>}
    </main>
  )
}

export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  /** Stacked under the title on phones, beside it from `sm`. */
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-medium tracking-[-0.025em]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{body}</p>
    </div>
  )
}

/** Centred card used by the sign-in and workspace-creation screens. */
export function CardPage({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xs/5">
        <h1 className="text-xl font-medium tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        <div className="mt-5 flex flex-col gap-4">{children}</div>
      </div>
    </main>
  )
}

/** Server-provided messages are safe to show; anything else gets a plain sentence. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status < 500) return error.message
  return "Something went wrong on our side. Try again in a moment."
}

/** Inline failure state with a retry action; never shows stacks. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center"
    >
      <p className="text-sm font-medium">Couldn't load this.</p>
      <p className="text-xs text-muted-foreground">{errorMessage(error)}</p>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/** Router-level error component: reloads loaders and clears the error boundary. */
export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter()
  return (
    <ErrorState
      error={error}
      onRetry={() => {
        reset()
        void router.invalidate()
      }}
    />
  )
}
