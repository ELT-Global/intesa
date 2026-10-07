export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  /** Accessible name, announced as the textbox label. */
  label: string
  placeholder?: string
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
}

/** What the instant textarea hands to the real editor when it replaces it. */
export interface Handoff {
  focused: boolean
  from: number
  to: number
}
