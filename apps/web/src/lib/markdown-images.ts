const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// `![alt](url)` or `![alt](<url> "title")` pointing at exactly `url`, and the line break after it.
const imagePattern = (url: string) =>
  new RegExp(
    String.raw`!\[(?:\\.|[^\]\\])*\]\(\s*<?${escapeRegExp(url)}>?(?:\s+"[^"]*")?\s*\)(\n)?`,
    "g",
  )

/** `markdown` without its images of `url`; one alone on its line takes the line with it. */
export function removeImage(markdown: string, url: string) {
  return markdown.replace(imagePattern(url), (_match, newline: string | undefined, at: number) =>
    at === 0 || markdown[at - 1] === "\n" ? "" : (newline ?? ""),
  )
}

/** `markdown` with every link to `from` pointing at `to` instead. */
export const replaceUrl = (markdown: string, from: string, to: string) =>
  markdown.split(from).join(to)
