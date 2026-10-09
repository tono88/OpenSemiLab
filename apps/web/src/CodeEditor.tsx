import { useEffect, useRef, useState } from 'react'
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection } from '@codemirror/view'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search'
import { languageForFile } from './editorLanguages'
import { editorTheme, sourceHighlight } from './editorTheme'
import { textChange } from './editorText'

const externalChange = Annotation.define<boolean>()
type Props = { path: string; value: string; onChange: (text: string) => void; locale: 'es' | 'en' }

export default function CodeEditor({ path, value, onChange, locale }: Props) {
  const es = locale === 'es'
  const host = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null)
  const callback = useRef(onChange), currentValue = useRef(value)
  callback.current = onChange; currentValue.current = value
  const wrapExtension = useRef(new Compartment())
  const [wrapped, setWrapped] = useState(false)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const language = languageForFile(path)

  useEffect(() => {
    if (!host.current) return
    const language = languageForFile(path)
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: currentValue.current, extensions: [
        editorTheme, syntaxHighlighting(sourceHighlight), language.support,
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
        history(), drawSelection(), dropCursor(), rectangularSelection(),
        indentOnInput(), indentUnit.of(language.indent), bracketMatching(), foldGutter(),
        highlightSelectionMatches(), keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        wrapExtension.current.of(wrapped ? EditorView.lineWrapping : []),
        EditorView.contentAttributes.of({ 'aria-label': path, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalChange))) callback.current(update.state.doc.toString())
          if (update.docChanged || update.selectionSet) {
            const position = update.state.selection.main.head, line = update.state.doc.lineAt(position)
            setCursor({ line: line.number, column: position - line.from + 1 })
          }
        }),
      ] }),
    })
    editor.current = view; setCursor({ line: 1, column: 1 })
    return () => { view.destroy(); editor.current = null }
  }, [path])

  useEffect(() => {
    const view = editor.current
    if (!view) return
    const changes = textChange(view.state.doc.toString(), value)
    if (changes) view.dispatch({ changes, annotations: [externalChange.of(true), Transaction.addToHistory.of(false)] })
  }, [value, path])

  useEffect(() => { editor.current?.dispatch({ effects: wrapExtension.current.reconfigure(wrapped ? EditorView.lineWrapping : []) }) }, [wrapped])

  return <section className="code-editor">
    <div className="code-editor-actions"><span>{language.name === 'Texto' && !es ? 'Text' : language.name}</span><button type="button" onClick={() => { if (editor.current) openSearchPanel(editor.current) }}>{es ? 'Buscar' : 'Find'} <kbd>Ctrl F</kbd></button><button type="button" aria-pressed={wrapped} onClick={() => setWrapped(value => !value)}>{es ? 'Ajustar líneas' : 'Wrap lines'}</button></div>
    <div className="code-editor-surface" ref={host}/>
    <footer className="code-editor-status"><span>Ln {cursor.line}, Col {cursor.column} · {language.indent === '\t' ? 'Tab' : `${es ? 'Espacios' : 'Spaces'} ${language.indent.length}`}</span><small>{es ? 'Ctrl Z: deshacer · Esc, Tab: salir del editor' : 'Ctrl Z: undo · Esc, Tab: leave editor'}</small></footer>
  </section>
}
