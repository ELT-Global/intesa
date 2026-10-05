import { useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api"

/**
 * Shows the latest failure of any mutation that declares `meta: { errorNotice: "..." }`.
 * Mount once, inside the QueryClientProvider.
 */
export function MutationErrorNotice() {
  const cache = useQueryClient().getMutationCache()
  const [error, setError] = useState<{ id: number; message: string } | null>(null)

  useEffect(
    () =>
      cache.subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return
        const fallback = event.mutation.meta?.errorNotice
        if (typeof fallback !== "string") return
        const err = event.action.error
        setError({
          id: Date.now(),
          // Client errors explain themselves; server failures get the action-specific fallback.
          message: err instanceof ApiError && err.status < 500 ? err.message : fallback,
        })
      }),
    [cache],
  )

  const id = error?.id
  useEffect(() => {
    if (id === undefined) return
    const timer = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(timer)
  }, [id])

  if (!error) return null
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[60] flex max-w-sm items-start gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-[13px] text-destructive-foreground shadow-lg"
    >
      <span className="flex-1">{error.message}</span>
      <Button variant="ghost" size="xs" icon aria-label="Dismiss" onClick={() => setError(null)}>
        <X />
      </Button>
    </div>
  )
}
