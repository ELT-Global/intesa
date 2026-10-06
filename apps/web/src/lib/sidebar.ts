import { useCallback, useEffect, useState } from "react"

const KEY = "intesa-sidebar-collapsed"

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

/** Collapsed state of the desktop sidebar, persisted, with the `[` shortcut. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(read)

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(KEY, next ? "1" : "0")
      } catch {}
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el?.closest("input, textarea, select, [contenteditable], [role=menu], [role=listbox]")) {
        return
      }
      if (document.querySelector("[role=dialog]")) return
      // Below the md breakpoint the sidebar is a drawer, which has its own toggle.
      if (!window.matchMedia("(min-width: 768px)").matches) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle])

  return { collapsed, toggle }
}
