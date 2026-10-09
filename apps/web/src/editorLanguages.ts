import { StreamLanguage, type Language, type LanguageSupport } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'
import { javascript } from '@codemirror/lang-javascript'
import { verilog } from '@codemirror/legacy-modes/mode/verilog'
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { tcl } from '@codemirror/legacy-modes/mode/tcl'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { c, cpp } from '@codemirror/legacy-modes/mode/clike'

// SPICE is not a programming language: '*' comments and '+' continuation
// lines must not be interpreted as multiplication or a new component.
const spice = StreamLanguage.define({
  name: 'SPICE',
  startState: () => ({}),
  token(stream) {
    if (stream.sol() && stream.match(/\s*\*/)) { stream.skipToEnd(); return 'comment' }
    if (stream.eatSpace()) return null
    if (stream.match(/(?:\$|;).*/)) return 'comment'
    if (stream.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) return 'string'
    if (stream.match(/\.[a-z_][\w]*/i)) return 'keyword'
    if (stream.match(/(?:op|ac|dc|tran|meas|measure|print|plot|save|let|set|quit|alter|run|wrdata|write|find|at|from|to|trig|targ|val|rise|fall|param|max|min|avg|rms|dec|lin|oct|pulse|sin|exp|pwl)\b/i)) return 'keyword'
    if (stream.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmunpf])?\b/i)) return 'number'
    if (stream.sol() && stream.match(/[rvclieqmdjxabhfgsktuwzn][\w.:]*/i)) return 'variableName.definition'
    if (stream.match(/[a-z_][\w.:]*(?=\s*=)/i)) return 'propertyName'
    if (stream.match(/[a-z_][\w.:]*/i)) return 'variableName'
    if (stream.match(/[{}()[\]]/)) return 'bracket'
    if (stream.match(/[=+*/^<>-]/)) return 'operator'
    stream.next(); return null
  },
  languageData: { commentTokens: { line: '*' } },
})

const make = StreamLanguage.define({
  name: 'Makefile',
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(/#.*/)) return 'comment'
    if (stream.match(/\$\([^)]*\)|\$\{[^}]*\}|\$[@<^?*%+|]/)) return 'variableName.special'
    if (stream.match(/"(?:[^"\\]|\\.)*"|'[^']*'/)) return 'string'
    if (stream.match(/[\w./%-]+(?=\s*:)/)) return 'heading'
    if (stream.match(/(?:include|-include|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|export|unexport|override)\b/)) return 'keyword'
    if (stream.match(/[a-z_][\w]*(?=\s*(?:[:?+]?=))/i)) return 'propertyName'
    if (stream.match(/\d+(?:\.\d+)?\b/)) return 'number'
    if (stream.match(/[:?+]?=|[|&:]/)) return 'operator'
    stream.next(); return null
  },
  languageData: { commentTokens: { line: '#' } },
})

const config = StreamLanguage.define({
  name: 'Configuration',
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(/[#;].*/)) return 'comment'
    if (stream.match(/\[[^\]]+\]/)) return 'heading'
    if (stream.match(/"[^"\n]*"|'[^'\n]*'/)) return 'string'
    if (stream.match(/[\w.-]+(?=\s*[=:])/)) return 'propertyName'
    if (stream.match(/\b(?:true|false|null|bmc|prove|cover)\b/)) return 'atom'
    if (stream.match(/\d+(?:\.\d+)?\b/)) return 'number'
    stream.next(); return null
  },
  languageData: { commentTokens: { line: '#' } },
})

const sv = StreamLanguage.define(verilog), vh = StreamLanguage.define(vhdl)
const languages = {
  json: json(), python: python(), xml: xml(), yaml: StreamLanguage.define(yaml),
  shell: StreamLanguage.define(shell), tcl: StreamLanguage.define(tcl), toml: StreamLanguage.define(toml),
  c: StreamLanguage.define(c), cpp: StreamLanguage.define(cpp),
  js: javascript(), ts: javascript({ typescript: true }),
  jsx: javascript({ jsx: true }), tsx: javascript({ jsx: true, typescript: true }),
}
const md = markdown({ codeLanguages(info) {
  const name = info.toLowerCase().split(/\s/)[0]
  const language = name === 'sv' || name === 'systemverilog' || name === 'verilog' ? sv
    : name === 'vhdl' ? vh : name === 'spice' ? spice : name === 'make' || name === 'makefile' ? make
    : name === 'sh' || name === 'bash' ? languages.shell
    : name === 'py' ? languages.python : name === 'javascript' ? languages.js
    : name === 'typescript' ? languages.ts : languages[name as keyof typeof languages]
  return language ? ('language' in language ? language.language : language) : null
} })

type EditorLanguage = { name: string; support: Language | LanguageSupport | readonly []; indent: string }
export function languageForFile(path: string): EditorLanguage {
  const file = path.toLowerCase().split('/').pop() ?? ''
  const extension = file.split('.').pop()
  const choice = (name: string, support: EditorLanguage['support'], indent = '  '): EditorLanguage => ({ name, support, indent })
  if (/\.(sv|svh|v|vh)$/.test(file)) return choice('SystemVerilog', sv)
  if (/\.(vhd|vhdl)$/.test(file)) return choice('VHDL', vh)
  if (/\.(spice|cir|ckt|lib|cdl)$/.test(file)) return choice('SPICE', spice)
  if (file === 'makefile' || file === 'gnumakefile' || extension === 'mk') return choice('Makefile', make, '\t')
  if (/\.(md|markdown)$/.test(file)) return choice('Markdown', md)
  if (extension === 'py') return choice('Python', languages.python, '    ')
  if (extension === 'json') return choice('JSON', languages.json)
  if (/\.(yaml|yml)$/.test(file)) return choice('YAML', languages.yaml)
  if (/\.(xml|svg|html)$/.test(file)) return choice('XML', languages.xml)
  if (/\.(sh|bash|zsh)$/.test(file)) return choice('Shell', languages.shell)
  if (/\.(tcl|sdc|pcf)$/.test(file)) return choice('Tcl', languages.tcl)
  if (extension === 'toml') return choice('TOML', languages.toml)
  if (/\.(c|h)$/.test(file)) return choice('C', languages.c)
  if (/\.(cpp|hpp|cc)$/.test(file)) return choice('C++', languages.cpp)
  if (/\.(js|ts|jsx|tsx)$/.test(file)) return choice(extension === 'ts' || extension === 'tsx' ? 'TypeScript' : 'JavaScript', languages[extension as 'js' | 'ts' | 'jsx' | 'tsx'])
  if (/\.(sby|ini|cfg|conf)$/.test(file) || file === '.gitignore' || file === '.env') return choice('Config', config)
  return choice('Texto', [])
}
