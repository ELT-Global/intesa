import { markdownLanguage } from "@codemirror/lang-markdown"
import { LanguageSupport } from "@codemirror/language"
import { Prec } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

import { blockquoteKeymap } from "./blockquotes"
import { codeBlockKeymap } from "./code-blocks"
import { livePreviewPlugin } from "./decorations"
import { formattingKeymap } from "./formatting"
import { inputRules } from "./input-rules"
import { listKeymap } from "./lists"
import { editorTheme } from "./theme"

export function createMarkdownEditorExtensions() {
  return [
    // Not `markdown()`: it drags the HTML, CSS and JS grammars into the chunk for a feature
    // (embedded-language highlighting) this editor does not use.
    new LanguageSupport(markdownLanguage),
    livePreviewPlugin,
    inputRules,
    Prec.highest(codeBlockKeymap),
    Prec.highest(blockquoteKeymap),
    Prec.high(listKeymap),
    formattingKeymap,
    editorTheme,
    EditorView.lineWrapping,
  ]
}

// Re-export public API for consumers and tests
export {
  ALERT_META,
  AlertBadgeWidget,
  blockquoteContinue,
  blockquoteEnter,
  blockquoteKeymap,
  isAlertTitleLine,
  isInBlockquote,
} from "./blockquotes"
export {
  codeBlockBackspace,
  codeBlockDedent,
  codeBlockEnter,
  codeBlockIndent,
  codeBlockKeymap,
} from "./code-blocks"
export { formattingKeymap, insertLink, wrapSelection } from "./formatting"
export { backspaceUndoInputRule, INPUT_RULES } from "./input-rules"
export {
  BulletWidget,
  CheckboxWidget,
  dedentListItem,
  formatOrderedMarker,
  indentListItem,
  listKeymap,
  OrderedMarkerWidget,
  toAlpha,
  toggleCheckbox,
  toRoman,
} from "./lists"
export { codeBlockAt, inCode } from "./shared/code"
export { cursorOnLine, cursorTouches } from "./shared/cursor"
export { editorTheme } from "./theme"
