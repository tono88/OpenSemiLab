import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'

const urls = new Map()
async function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name)
  let source = stripTypeScriptTypes(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'))
  for (const match of [...source.matchAll(/from\s+(['"])([^'"]+)\1/g)]) {
    const specifier = match[2]
    const url = specifier.startsWith('./') ? await moduleUrl(specifier.slice(2)) : import.meta.resolve(specifier)
    source = source.replace(match[0], `from '${url}'`)
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  urls.set(name, url)
  return url
}
const { languageForFile } = await import(await moduleUrl('editorLanguages'))
const { sourceHighlight, logHighlight } = await import(await moduleUrl('editorTheme'))
const { logLanguage } = await import(await moduleUrl('logLanguage'))
const { readableLog, textChange } = await import(await moduleUrl('editorText'))

function highlights(text, extension, style) {
  const state = EditorState.create({ doc: text, extensions: [extension] })
  const tree = ensureSyntaxTree(state, text.length, 1000)
  assert.ok(tree, 'parser must cover the full document')
  const tokens = []
  highlightTree(tree, style, (from, to, css) => tokens.push({ text: text.slice(from, to), css }))
  return tokens
}
function has(tokens, css, text) { return tokens.some(token => token.css.includes(css) && token.text.includes(text)) }

test('HDL comments, keywords and strings are parsed without changing their text', () => {
  const sv = highlights('// reset signal\nmodule top;\n/* multiple\n lines */\ninitial $display("// not a comment");\nendmodule', languageForFile('rtl/top.sv').support, sourceHighlight)
  assert.ok(has(sv, 'syntax-comment', 'reset signal'))
  assert.ok(has(sv, 'syntax-comment', 'multiple'))
  assert.ok(has(sv, 'syntax-keyword', 'module'))
  assert.ok(has(sv, 'syntax-string', '// not a comment'))
  const vh = highlights('-- reset signal\nentity top is\nend entity;', languageForFile('rtl/top.vhd').support, sourceHighlight)
  assert.ok(has(vh, 'syntax-comment', 'reset signal'))
  assert.ok(has(vh, 'syntax-keyword', 'entity'))
})

test('Markdown headings, links and fenced HDL retain their language highlighting', () => {
  const tokens = highlights('# Primeros pasos\n[Guía](https://example.test)\n```systemverilog\n// reset\nmodule top; endmodule\n```\n', languageForFile('README.md').support, sourceHighlight)
  assert.ok(has(tokens, 'syntax-heading', 'Primeros pasos'))
  assert.ok(has(tokens, 'syntax-link', 'https://example.test'))
  assert.ok(has(tokens, 'syntax-comment', 'reset'))
  assert.ok(has(tokens, 'syntax-keyword', 'module'))
})

test('SPICE comments, directives, strings and engineering numbers are distinct', () => {
  const tokens = highlights('* Amplificador\n.include "models/demo.lib"\nVDD vdd 0 1.8\nR1 vdd out 2.2k\n.meas tran delay FIND v(out) AT=1u\n', languageForFile('test.cir').support, sourceHighlight)
  assert.ok(has(tokens, 'syntax-comment', 'Amplificador'))
  assert.ok(has(tokens, 'syntax-keyword', '.include'))
  assert.ok(has(tokens, 'syntax-string', 'models/demo.lib'))
  assert.ok(has(tokens, 'syntax-number', '2.2k'))
})

test('JSON URLs stay strings, Python comments are comments, Makefile uses tabs', () => {
  const json = highlights('{"url":"https://host/#anchor", "n":42}', languageForFile('project.json').support, sourceHighlight)
  assert.ok(has(json, 'syntax-string', 'https://host/#anchor'))
  assert.ok(!has(json, 'syntax-comment', 'host'))
  const py = highlights('# comentario\ndef run():\n    return "# literal"\n', languageForFile('scripts/test.py').support, sourceHighlight)
  assert.ok(has(py, 'syntax-comment', 'comentario'))
  assert.ok(has(py, 'syntax-string', '# literal'))
  assert.equal(languageForFile('Makefile').indent, '\t')
  assert.equal(languageForFile('scripts/test.py').indent, '    ')
  assert.equal(languageForFile('unknown.txt').name, 'Texto')
})

test('console highlights timestamps, tool tags, severities, paths and commands', () => {
  const text = '[2026-10-09T04:23:00.123Z] [INFO] [YOSYS] Checking rtl/top.sv:42\n[04:23:01] [WARN] Clock 25ns\nERROR: synthesis failed\nPASS all checks\n$ ngspice -b test.cir\n=== Synthesis ===\n# comentario\n0 errors, 0 warnings\n'
  const tokens = highlights(text, logLanguage, logHighlight)
  for (const [css, value] of [['log-time','2026-10-09'],['log-tag','YOSYS'],['log-info','INFO'],['log-warning','WARN'],['log-error','ERROR'],['log-success','PASS'],['log-path','rtl/top.sv:42'],['log-command','ngspice'],['log-heading','Synthesis'],['log-comment','comentario']]) assert.ok(has(tokens, css, value), `${css}: ${value}`)
  assert.ok(!tokens.some(token => token.css === 'log-error' && /errors/.test(token.text)))
})

test('terminal escape sequences are removed without interpreting HTML or losing text', () => {
  const text = '\x1b[31mERROR\x1b[0m\r\n\x1b]8;;https://host\x1b\\link\x1b]8;;\x1b\\ <script>alert(1)</script>\n'
  assert.equal(readableLog(text), 'ERROR\nlink <script>alert(1)</script>\n')
})

test('small edits and large live appends preserve the exact document', () => {
  const cases = [['abc', 'abc'], ['', 'á µ 🎉'], ['abc', 'ac'], ['abc', 'xabc'], ['abcdef', 'abXYef'], ['a\nb\n', 'a\nb\nnew output\n'], ['old content', ''], ['😀', '😎']]
  for (const [previous, next] of cases) {
    const changes = textChange(previous, next)
    if (!changes) assert.equal(previous, next)
    else assert.equal(EditorState.create({ doc: previous }).update({ changes }).state.doc.toString(), next)
  }
  const previous = 'log line\n'.repeat(50000), next = previous + 'PASS final\n'
  assert.deepEqual(textChange(previous, next), { from: previous.length, to: previous.length, insert: 'PASS final\n' })
})
