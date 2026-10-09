import { StreamLanguage } from '@codemirror/language'
import { Tag } from '@lezer/highlight'

export const logTags = {
  time: Tag.define(), tag: Tag.define(), error: Tag.define(), warning: Tag.define(),
  success: Tag.define(), info: Tag.define(), command: Tag.define(), path: Tag.define(),
  number: Tag.define(), heading: Tag.define(), comment: Tag.define(),
}

// Keep severity in the message itself: colors supplement ERROR/WARNING/PASS
// rather than replacing those labels. Counts such as "0 errors" are neutral.
function severity(text: string) {
  if (/\b(?:error|fatal|critical|failed|failure|fail|traceback|assertionerror|runtimeerror|valueerror)\b/i.test(text)) return 'error'
  if (/\b(?:warning|warn)\b/i.test(text)) return 'warning'
  if (/\b(?:pass|passed|success)\b/i.test(text)) return 'success'
  if (/\b(?:info|note|debug)\b/i.test(text)) return 'info'
  return null
}

const timestamp = /\[?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?)\]?/
// Prefix custom token names so legacy aliases such as "error" -> "invalid"
// and "tag" -> "tagName" cannot override our console palette.
function style(name: string | null) { return name ? `console${name[0].toUpperCase()}${name.slice(1)}` : null }
export const logLanguage = StreamLanguage.define({
  name: 'Execution log',
  startState: () => ({ base: '' }),
  tokenTable: Object.fromEntries(Object.entries(logTags).map(([name, tag]) => [style(name)!, tag])),
  token(stream, state) {
    if (stream.sol()) {
      const text = stream.string.trimStart()
      state.base = ''
      if (/^(?:#|\/\/)/.test(text)) { stream.skipToEnd(); return style('comment') }
      if (/^(?:[=*_─━-]{3,}|\d+\.\s+(?:Executing|Printing|Running)|(?:Step|STEP)\s+\d)/.test(text)) { stream.skipToEnd(); return style('heading') }
      if (/^(?:\$\s|\+\s|[\w.-]+@[\w.-]+:[^$#]*[$#]\s)/.test(text)) { stream.skipToEnd(); return style('command') }
      const prefix = text.replace(timestamp, '').replace(/^\s*\[[^\]]+\]\s*/, '').trimStart()
      const level = severity(prefix.split(/\s+/).slice(0, 2).join(' '))
      if (level) state.base = level
    }
    if (stream.eatSpace()) return null
    if (stream.match(timestamp)) return style('time')
    if (stream.match(/\[[^\]\n]+\]/)) return style(severity(stream.current()) ?? 'tag')
    if (stream.match(/(?:\.?\.?\/|[A-Za-z]:[\\/]|[a-zA-Z_][\w.-]*[\\/])[\w./\\@:+-]+|[\w.-]+\.(?:svh?|vhd|vhdl|spice|cir|json|yaml|log|rpt|sdc|py|v)(?::\d+(?::\d+)?)?/)) return style('path')
    if (stream.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:ns|us|ms|ps|s|um|µm|MHz|GHz|Hz|%)?\b/i)) return style('number')
    if (stream.match(/[A-Za-z_][\w.-]*/)) return style(severity(stream.current()) ?? (state.base || null))
    stream.next(); return style(state.base || null)
  },
})
