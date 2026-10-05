import { X } from "lucide-react"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { dismissTaskError, useTaskError } from "@/lib/tasks"

/** Shows the latest failed task mutation. Mounted by TaskDetailSheet; mount it once per page. */
export function TaskErrorNotice() {
  const error = useTaskError()
  const id = error?.id
  useEffect(() => {
    if (id === undefined) return
    const timer = setTimeout(dismissTaskError, 6000)
    return () => clearTimeout(timer)
  }, [id])

  if (!error) return null
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[60] flex max-w-sm items-start gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-[13px] text-destructive-foreground shadow-lg"
    >
      <span className="flex-1">{error.message}</span>
      <Button variant="ghost" size="xs" icon aria-label="Dismiss" onClick={dismissTaskError}>
        <X />
      </Button>
    </div>
  )
}
