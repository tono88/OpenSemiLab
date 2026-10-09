// Dev-only fixture. These files are not entries in the production Vite build.
import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import CodeEditor from '../../src/CodeEditor'
import LogOutput, { ConsoleLegend, type LogOutputHandle } from '../../src/LogOutput'
import '../../src/editor.css'

const sources = {
  'top.sv': '// reset signal\nmodule top;\n  logic ready = 1;\nendmodule\n',
  'README.md': '# Primeros pasos\n\nEjecute `make test`.\n',
  'script.py': '# calibración\ndef run():\n    return "listo"\n',
  'design.vhd': '-- reset\nentity top is\nend entity;\n',
}
const initialLog = '[2026-10-09T04:23:00.123Z] [INFO] [YOSYS] Reading rtl/top.sv:42\n[04:23:01] WARNING: clock is 25ns\nERROR: failed timing\nPASS simulation\n$ ngspice -b test.cir\n<script>window.injected = true</script>\n'

function Harness() {
  const [files, setFiles] = useState(sources), [path, setPath] = useState<keyof typeof sources>('top.sv')
  const [text, setText] = useState(initialLog), [following, setFollowing] = useState(false)
  const log = useRef<LogOutputHandle>(null)
  return <main style={{ background: '#07130f', color: '#dce9ee', padding: 20 }}>
    <select aria-label="Archivo" value={path} onChange={event => setPath(event.target.value as keyof typeof sources)}>{Object.keys(files).map(name => <option key={name}>{name}</option>)}</select>
    <button onClick={() => setFiles(files => ({ ...files, [path]: '// external update\n' + files[path] }))}>Actualizar contenido externo</button>
    <CodeEditor path={path} value={files[path]} onChange={value => setFiles(files => ({ ...files, [path]: value }))} locale="es"/>
    <output data-testid="source" hidden>{files[path]}</output>
    <button onClick={() => log.current?.selectAll()}>Seleccionar todo</button>
    <button onClick={() => navigator.clipboard.writeText(log.current?.text() ?? '')}>Copiar consola</button>
    <button onClick={() => { setFollowing(true); setText(Array.from({ length: 10000 }, (_, index) => `[04:23:00] [INFO] line ${index}\n`).join('') + 'PASS FINAL MARKER\n') }}>Log largo</button>
    <button onClick={() => setText(text => text + '[04:24:00] [INFO] APPENDED MARKER\n')}>Agregar log</button>
    <ConsoleLegend locale="es"/><LogOutput ref={log} text={text} follow={following} locale="es"/>
    <output data-testid="log" hidden>{text}</output>
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness/></StrictMode>)
