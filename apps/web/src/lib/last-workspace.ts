const KEY = "intesa-last-workspace"

export function getLastWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastWorkspace(slug: string) {
  try {
    localStorage.setItem(KEY, slug)
  } catch {}
}
