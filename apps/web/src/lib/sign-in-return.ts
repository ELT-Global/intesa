// Where a signed-out visitor was heading, kept across the sign-in screens (and the Google round
// trip, which ends on "/"). sessionStorage keeps it to this tab; it is read back exactly once.
const KEY = "intesa-return-to"

/** In-app absolute paths only: a scheme or `//host` would turn the redirect into an open one. */
export function isSafeReturnPath(path: string): boolean {
  if (!path.startsWith("/") || path[1] === "/" || path[1] === "\\") return false
  // URL parsers drop tabs and newlines, so "/", tab, "/" would become "//".
  return ![...path].some((ch) => ch.charCodeAt(0) < 0x20)
}

/** "/" is the default landing, and the Google round trip arrives there signed out. */
export function rememberReturnPath(path: string) {
  try {
    if (path !== "/" && isSafeReturnPath(path)) sessionStorage.setItem(KEY, path)
  } catch {}
}

/** The remembered path, forgotten as it is returned. */
export function takeReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return path && isSafeReturnPath(path) ? path : null
  } catch {
    return null
  }
}
