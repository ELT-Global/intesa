import { useCallback, useSyncExternalStore } from "react"

export type Theme = "dark" | "light"

export const THEME_KEY = "intesa-theme"

// Runs inline in <head> so the class is set before first paint. Dark unless the user chose light.
export const themeInitScript = `try{document.documentElement.classList.toggle("dark",localStorage.getItem("${THEME_KEY}")!=="light")}catch(e){document.documentElement.classList.add("dark")}`

const listeners = new Set<() => void>()

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    current,
    () => "dark" as Theme,
  )
  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle("dark", next === "dark")
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {}
    for (const l of listeners) l()
  }, [])
  return { theme, setTheme }
}
