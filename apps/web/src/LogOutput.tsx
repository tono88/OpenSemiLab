import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView, drawSelection, keymap } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { defaultKeymap, selectAll } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { logLanguage } from './logLanguage'
import { editorTheme, logHighlight } from './editorTheme'
import { readableLog, textChange } from './editorText'

export type LogOutputHandle = { selectAll: () => void; text: () => string }
type Props = { text: string; id?: string; follow?: boolean; locale: 'es' | 'en' }

// CodeMirror renders a viewport for long logs instead of thousands of React
// spans on each polling update. Copy/select operate on the COMPLETE document.
const LogOutput = forwardRef<LogOutputHandle, Props>(function LogOutput({ text, id, follow = false, locale }, ref) {
  const host = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null)
  const readable = useMemo(() => readableLog(text), [text]), latest = useRef(readable)
  latest.current = readable
  useImperativeHandle(ref, () => ({
    selectAll() { if (editor.current) { editor.current.focus(); selectAll(editor.current) } },
    text: () => latest.current,
  }), [])

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: latest.current, extensions: [
      editorTheme, syntaxHighlighting(logHighlight), logLanguage,
      EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping,
      drawSelection(), highlightSelectionMatches(), keymap.of([...searchKeymap, ...defaultKeymap]),
      EditorView.contentAttributes.of({ 'aria-label': locale === 'es' ? 'Registro de ejecución' : 'Execution log', tabindex: '0' }),
    ] }) })
    editor.current = view
    if (follow) view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'end' }) })
    return () => { view.destroy(); editor.current = null }
  }, [])

  useEffect(() => {
    const view = editor.current
    if (!view) return
    const changes = textChange(view.state.doc.toString(), readable)
    if (!changes) return
    const scroll = view.scrollDOM
    const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60
    view.dispatch({ changes, annotations: Transaction.addToHistory.of(false), effects: follow && nearBottom ? EditorView.scrollIntoView(readable.length, { y: 'end' }) : [] })
  }, [readable, follow])

  return <section id={id} className="log-output"><div ref={host}/></section>
})
export default LogOutput

export function ConsoleLegend({ locale }: { locale: 'es' | 'en' }) {
  const es = locale === 'es'
  return <div className="console-legend" aria-label={es ? 'Colores de consola' : 'Console colors'}><span className="log-time">{es ? 'Hora' : 'Time'}</span><span className="log-tag">[tag]</span><span className="log-info">INFO</span><span className="log-warning">WARNING</span><span className="log-error">ERROR</span><span className="log-success">PASS</span></div>
}
