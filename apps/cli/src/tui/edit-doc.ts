import { formatTaskDoc, parseTaskDoc } from "../io/task-doc"

// The text a task is edited as in $EDITOR: the task document of `task edit`, with the title
// as its only property for now, then the description in Markdown.

export const toDoc = (title: string, body: string | null) =>
  formatTaskDoc({ title, body: body ?? "" })

// Other properties are ignored here. A document that does not read saves nothing: an empty
// title says so.
export function fromDoc(text: string): { title: string; body: string } {
  try {
    const doc = parseTaskDoc(text)
    return { title: doc.title ?? "", body: doc.body }
  } catch {
    return { title: "", body: "" }
  }
}
