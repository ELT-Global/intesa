export interface MarkdownEditorProps {
  value: string
  /** Not needed when `readOnly`. */
  onChange?: (value: string) => void
  /** Accessible name, announced as the textbox label. */
  label: string
  placeholder?: string
  /** Shows the document rendered, with nothing to edit and no Markdown revealed at the caret. */
  readOnly?: boolean
  /** Hard cap on the document length; edits that would exceed it are rejected. */
  maxLength?: number
  autoFocus?: boolean
  /** Classes for the outer wrapper (sizing, scrolling). */
  className?: string
  /** Marks the focused field so a surrounding dialog leaves Escape to it. */
  keepsEscape?: boolean
  onKeyDown?: (event: React.KeyboardEvent) => void
  onFocus?: () => void
  onBlur?: () => void
  /**
   * Uploads a pasted or dropped image and resolves to its URL; the editor inserts it as
   * `![name](url)`. Without it, images are not accepted.
   */
  uploadImage?: (file: File) => Promise<string>
}

/** The caret the editor takes over from the textarea it replaces; absent when that was unfocused. */
export interface Restore {
  from: number
  to: number
}

/** Props of the lazily loaded CodeMirror view. */
export interface EditorViewProps extends MarkdownEditorProps {
  restore: Restore | null
}
