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

export function clearLastWorkspace(slug: string) {
  try {
    if (localStorage.getItem(KEY) === slug) localStorage.removeItem(KEY)
  } catch {}
}
