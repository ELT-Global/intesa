import { useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api"

type Notice = { id: number; message: string; tone: "info" | "error" }

const EVENT = "app:notice"

/** Shows a short message in the notice region from anywhere, e.g. "Copied WEB-12". */
export function notify(message: string, tone: Notice["tone"] = "info") {
  window.dispatchEvent(new CustomEvent<Omit<Notice, "id">>(EVENT, { detail: { message, tone } }))
}

/**
 * The page's one notice region. It shows the latest failure of any mutation that declares
 * `meta: { errorNotice: "..." }`, plus messages sent through `notify`.
 * Mount once, inside the QueryClientProvider.
 */
export function MutationErrorNotice() {
  const cache = useQueryClient().getMutationCache()
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(
    () =>
      cache.subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return
        const fallback = event.mutation.meta?.errorNotice
        if (typeof fallback !== "string") return
        const err = event.action.error
        setNotice({
          id: Date.now(),
          tone: "error",
          // Client errors explain themselves; server failures get the action-specific fallback.
          message: err instanceof ApiError && err.status < 500 ? err.message : fallback,
        })
      }),
    [cache],
  )

  useEffect(() => {
    const onNotice = (e: Event) => {
      const detail = (e as CustomEvent<Omit<Notice, "id">>).detail
      setNotice({ id: Date.now(), ...detail })
    }
    window.addEventListener(EVENT, onNotice)
    return () => window.removeEventListener(EVENT, onNotice)
  }, [])

  const id = notice?.id
  useEffect(() => {
    if (id === undefined) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [id])

  if (!notice) return null
  const error = notice.tone === "error"
  return (
    <div
      role={error ? "alert" : "status"}
      className={`fixed bottom-4 right-4 z-[60] flex max-w-sm items-start gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-[13px] shadow-lg ${error ? "text-destructive-foreground" : "text-foreground"}`}
    >
      <span className="flex-1">{notice.message}</span>
      <Button variant="ghost" size="xs" icon aria-label="Dismiss" onClick={() => setNotice(null)}>
        <X />
      </Button>
    </div>
  )
}
