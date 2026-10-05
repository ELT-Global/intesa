import type { ReactNode } from "react"

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

export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-medium tracking-[-0.025em]">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
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
