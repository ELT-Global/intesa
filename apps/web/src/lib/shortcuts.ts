import { useEffect, useRef, useSyncExternalStore } from "react"

const TYPING_TARGET =
  "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=menu], [role=listbox]"

/** Whether the browser reports an Apple platform (false when there is no `navigator`). */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform ?? "")
}

/** Whether this is a Mac, for labels. False on the server and while hydrating, then corrects. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    () => () => {},
    isMac,
    () => false,
  )
}

/**
 * True when a single-key shortcut should fire: a plain press (AltGr layouts count as plain),
 * not auto-repeat, not already handled, and not while typing, in a menu or with a dialog open.
 * With `shift`, the Shift key must be held as well (Shift is otherwise not checked).
 */
export function isPlainShortcut(
  e: KeyboardEvent,
  key: string,
  { shift = false }: { shift?: boolean } = {},
): boolean {
  if (e.key !== key || e.repeat || e.defaultPrevented) return false
  if (shift && !e.shiftKey) return false
  const altGr = e.getModifierState("AltGraph")
  if (!altGr && (e.metaKey || e.ctrlKey || e.altKey)) return false
  if ((e.target as HTMLElement | null)?.closest(TYPING_TARGET)) return false
  return !document.querySelector("[role=dialog]")
}

/**
 * True for Cmd+key on a Mac and Ctrl+key elsewhere, with no other modifier. Unlike plain
 * shortcuts this is safe to fire while typing; the caller decides what to do about open dialogs.
 */
export function isModShortcut(e: KeyboardEvent, key: string, mac = isMac()): boolean {
  if (e.key !== key || e.repeat || e.defaultPrevented || e.altKey || e.shiftKey) return false
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

/** Runs `run` (after preventDefault) for each key press that `matches`. */
export function useShortcut(matches: (e: KeyboardEvent) => boolean, run: () => void) {
  const latest = useRef({ matches, run })
  latest.current = { matches, run }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!latest.current.matches(e)) return
      e.preventDefault()
      latest.current.run()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
