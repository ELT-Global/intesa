// The text a task is edited as in $EDITOR: the title as a heading on the first line, then the
// description in Markdown. Kept on its own so a richer format can replace it in one place.

export const toDoc = (title: string, body: string | null) =>
  `# ${title}\n\n${(body ?? "").trimEnd()}\n`

export function fromDoc(text: string): { title: string; body: string } {
  const [first = "", ...rest] = text.replace(/\r\n?/g, "\n").split("\n")
  return {
    title: first.replace(/^#+\s*/, "").trim(),
    body: rest.join("\n").replace(/^\n+/, "").trimEnd(),
  }
}
