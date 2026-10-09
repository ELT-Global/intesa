import type { Mode } from "./mode"

// Markdown for a terminal: headings, emphasis, lists, code and tables, with clickable links
// where color is on. Wrapped to the terminal, but not wider than is comfortable to read.
export function renderMarkdown(text: string, mode: Mode): string {
  const out = Bun.markdown.ansi(text, {
    colors: mode.color,
    hyperlinks: mode.color,
    columns: Math.min(mode.width, 100),
  })
  return out.endsWith("\n") ? out : `${out}\n`
}
