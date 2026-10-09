import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { logTags } from './logLanguage'

export const editorTheme = EditorView.theme({
  '&': { backgroundColor: '#051014', color: '#dce9ee', height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"DM Mono", ui-monospace, monospace', lineHeight: '1.65', overflow: 'auto' },
  '.cm-content': { padding: '12px 0', caretColor: '#f1f7fa' },
  '.cm-line': { padding: '0 14px' },
  '.cm-gutters': { backgroundColor: '#09181e', color: '#7996a1', borderRight: '1px solid #20343d', fontSize: '11px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 9px 0 12px', minWidth: '38px' },
  '.cm-activeLine': { backgroundColor: '#10232b70' },
  '.cm-activeLineGutter': { backgroundColor: '#17303a', color: '#d5e9f0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ecf6fa' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#34556b90' },
  '.cm-matchingBracket': { outline: '1px solid #7fd4bf', backgroundColor: '#7fd4bf20' },
  '.cm-searchMatch': { backgroundColor: '#e9bf6030', outline: '1px solid #e9bf6070' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#e9bf6060' },
}, { dark: true })

export const sourceHighlight = HighlightStyle.define([
  { tag: tags.comment, class: 'syntax-comment' },
  { tag: [tags.keyword, tags.modifier], class: 'syntax-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'syntax-string' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: 'syntax-number' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'syntax-type' },
  { tag: [tags.propertyName, tags.attributeName], class: 'syntax-property' },
  { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], class: 'syntax-definition' },
  { tag: [tags.standard(tags.variableName), tags.special(tags.variableName)], class: 'syntax-builtin' },
  { tag: [tags.operator, tags.punctuation], class: 'syntax-operator' },
  { tag: [tags.tagName, tags.angleBracket], class: 'syntax-tag' },
  { tag: tags.heading, class: 'syntax-heading' },
  { tag: tags.strong, class: 'syntax-strong' },
  { tag: tags.emphasis, class: 'syntax-emphasis' },
  { tag: [tags.link, tags.url], class: 'syntax-link' },
  { tag: tags.monospace, class: 'syntax-code' },
  { tag: tags.invalid, class: 'syntax-invalid' },
])
export const logHighlight = HighlightStyle.define(Object.entries(logTags).map(([name, tag]) => ({ tag, class: `log-${name}` })))
