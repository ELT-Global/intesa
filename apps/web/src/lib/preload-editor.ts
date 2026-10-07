import { preloadMarkdownEditor } from "@intesa/markdown-editor"

/** Fetches the editor chunk once the browser is idle, so the first description opens instantly. */
export function preloadEditorWhenIdle(): () => void {
  const run = () => void preloadMarkdownEditor().catch(() => {})
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 3000 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(run, 1500)
  return () => clearTimeout(id)
}
