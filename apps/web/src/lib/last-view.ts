import { useMatches } from "@tanstack/react-router"
import { useEffect } from "react"

export type ProjectView = "board" | "table"

const key = (projectId: string) => `intesa-project-view:${projectId}`

export function getLastView(projectId: string): ProjectView {
  try {
    return localStorage.getItem(key(projectId)) === "table" ? "table" : "board"
  } catch {
    return "board"
  }
}

/** Remembers which view was last open for the project in the current route. */
export function useRememberProjectView() {
  const matches = useMatches()
  const projectId = (
    matches.find((m) => m.routeId === "/_app/w/$slug/projects/$projectId")?.params as
      | { projectId?: string }
      | undefined
  )?.projectId
  const last = matches[matches.length - 1]?.routeId ?? ""
  const view = last.endsWith("/board") ? "board" : last.endsWith("/table") ? "table" : null
  useEffect(() => {
    if (!projectId || !view) return
    try {
      localStorage.setItem(key(projectId), view)
    } catch {}
  }, [projectId, view])
}
