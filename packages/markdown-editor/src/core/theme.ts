import { EditorView } from "@codemirror/view"

export const editorTheme = EditorView.theme({
  "&": {
    fontSize: "15px",
    fontFamily: "var(--font-sans)",
    background: "transparent !important",
    color: "var(--foreground)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    background: "transparent !important",
    fontFamily: "inherit",
    lineHeight: "1.75",
    overflowX: "hidden",
  },
  ".cm-content": {
    background: "transparent !important",
    caretColor: "var(--foreground)",
    color: "var(--foreground)",
    wordBreak: "break-word",
    overflowWrap: "break-word",
  },
  ".cm-line": {
    paddingTop: "0",
    paddingBottom: "0",
    paddingLeft: "0",
    paddingRight: "0",
    color: "var(--foreground)",
  },
  ".cm-gutters": {
    display: "none",
  },
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--ring) 28%, transparent) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--ring) 28%, transparent) !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    marginLeft: "-1px",
  },
  ".cm-activeLine": {
    background: "transparent !important",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
  },
})
