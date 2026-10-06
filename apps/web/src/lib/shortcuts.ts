const TYPING_TARGET =
  "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=menu], [role=listbox]"

/**
 * True when a single-key shortcut should fire: a plain press (AltGr layouts count as plain),
 * not auto-repeat, not already handled, and not while typing, in a menu or with a dialog open.
 */
export function isPlainShortcut(e: KeyboardEvent, key: string): boolean {
  if (e.key !== key || e.repeat || e.defaultPrevented) return false
  const altGr = e.getModifierState("AltGraph")
  if (!altGr && (e.metaKey || e.ctrlKey || e.altKey)) return false
  if ((e.target as HTMLElement | null)?.closest(TYPING_TARGET)) return false
  return !document.querySelector("[role=dialog]")
}
