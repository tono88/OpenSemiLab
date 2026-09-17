import { useEffect, useMemo, useState } from 'react'
import { simulate } from './api'
import { Plot } from './Plot'
import DesignStudio from './DesignStudio'
import type { Experiment, Mode, SimulationResult } from './types'

const MODES: Mode[] = ['Explore', 'Learn', 'Design', 'Advanced', 'Research']
const defaults: Experiment = {
  name: 'Silicon PN junction', engine: 'educational',
  device: { kind: 'pn_junction_1d', material: 'silicon', length_um: 2, area_um2: 100, acceptor_cm3: 1e16, donor_cm3: 1e16, temperature_k: 300 },
  sweep: { start_v: -1, stop_v: 0.8, points: 73 }, numerics: { mesh_points: 201, relative_tolerance: 1e-8, max_iterations: 80 },
}

function NumberField({ label, value, unit, onChange, step = 'any' }: { label: string; value: number; unit: string; onChange: (n: number) => void; step?: string }) {
  return <label className="field"><span>{label}</span><div><input type="number" value={value} step={step} onChange={e => onChange(Number(e.target.value))}/><b>{unit}</b></div></label>
}

function App() {
  const [locale, setLocale] = useState<'es'|'en'>(() => localStorage.getItem('opensemilab.locale') === 'en' ? 'en' : 'es')
  const es=locale==='es'
  const [area, setArea] = useState<'design' | 'lab'>('design')
  const [mode, setMode] = useState<Mode>('Explore')
  const [experiment, setExperiment] = useState(defaults)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [activePlot, setActivePlot] = useState('potential')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const depth = MODES.indexOf(mode)
  const modeLabels: Record<Mode,string> = es
    ? {Explore:'Explorar',Learn:'Aprender',Design:'Diseñar',Advanced:'Avanzado',Research:'Investigación'}
    : {Explore:'Explore',Learn:'Learn',Design:'Design',Advanced:'Advanced',Research:'Research'}

  function changeLocale(next:'es'|'en') { setLocale(next); localStorage.setItem('opensemilab.locale',next) }

  async function run() {
    setRunning(true); setError('')
    try { setResult(await simulate(experiment)) } catch (e) { setError(e instanceof Error ? e.message : (es?'La simulación falló':'Simulation failed')) }
    finally { setRunning(false) }
  }
  useEffect(() => { void run() }, [])
  const selected = useMemo(() => result?.series.find(s => s.name === activePlot), [result, activePlot])
  const device = experiment.device
  const updateDevice = (patch: Partial<Experiment['device']>) => setExperiment(e => ({ ...e, device: { ...e.device, ...patch } }))

  return <div className="app-shell">
    <header><div className="brand"><div className="mark">OS</div><div><strong>OpenSemiLab</strong><small>{es?'Laboratorio de semiconductores':'Semiconductor laboratory'}</small></div></div><nav className="primary-nav"><button className={area==='design'?'active':''} onClick={()=>setArea('design')}>{es?'Estudio de diseño':'Design Studio'}</button><button className={area==='lab'?'active':''} onClick={()=>setArea('lab')}>{es?'Laboratorio de dispositivos':'Device Lab'}</button></nav><div className="header-tools"><div className="locale-switch" aria-label={es?'Idioma':'Language'}><button className={locale==='es'?'active':''} onClick={()=>changeLocale('es')}>ES</button><button className={locale==='en'?'active':''} onClick={()=>changeLocale('en')}>EN</button></div><div className="engine"><i/> {es?'Entorno local':'Local workspace'} <span>v0.2</span></div></div></header>
    {area === 'lab' ? <><nav className="modes" aria-label="Interface depth">
      {MODES.map((item, i) => <button className={mode === item ? 'active' : ''} onClick={() => setMode(item)} key={item}><em>0{i + 1}</em>{modeLabels[item]}</button>)}
    </nav>

    <main>
      <section className="intro"><div><p className="eyebrow">{es?'LABORATORIO DE DISPOSITIVOS / UNIÓN PN':'DEVICE LAB / PN JUNCTION'}</p><h1>{es?'Observe qué sucede':'See what happens'}<br/><span>{es?'dentro del silicio.':'inside the silicon.'}</span></h1><p>{es?'Cambie las condiciones del material, ejecute el modelo y conecte cada curva con la física que la produce.':'Change the material conditions. Run the model. Connect every curve to the physics beneath it.'}</p></div><div className="status-card"><span>{es?'PROFUNDIDAD':'DEPTH'}</span><b>{modeLabels[mode]}</b><p>{depth < 2 ? (es?'Controles guiados con términos científicos presentados en contexto.':'Guided controls with scientific terms introduced in context.') : (es?'Controles de ingeniería y procedencia completa del modelo.':'Engineering controls and complete model provenance.')}</p></div></section>

      <section className="workspace">
        <aside className="controls">
          <div className="panel-title"><div><span>01</span><h2>{es?'Construya la unión':'Build the junction'}</h2></div><small>{es?'Silicio':'Silicon'} · 1D</small></div>
          <div className="junction" aria-label={es?'Diagrama de unión PN':'PN junction diagram'}><div className="p"><b>P</b><small>{es?'aceptores':'acceptors'}</small></div><div className="depletion"><span>{es?'agotamiento':'depletion'}</span></div><div className="n"><b>N</b><small>{es?'donantes':'donors'}</small></div></div>
          <div className="control-grid">
            <NumberField label={es?'Dopaje del lado P':'P-side doping'} value={device.acceptor_cm3} unit="cm⁻³" onChange={acceptor_cm3 => updateDevice({ acceptor_cm3 })}/>
            <NumberField label={es?'Dopaje del lado N':'N-side doping'} value={device.donor_cm3} unit="cm⁻³" onChange={donor_cm3 => updateDevice({ donor_cm3 })}/>
            <NumberField label={es?'Temperatura':'Temperature'} value={device.temperature_k} unit="K" step="1" onChange={temperature_k => updateDevice({ temperature_k })}/>
            {depth >= 2 && <NumberField label={es?'Longitud del dispositivo':'Device length'} value={device.length_um} unit="µm" onChange={length_um => updateDevice({ length_um })}/>}
            {depth >= 2 && <NumberField label={es?'Área de la unión':'Junction area'} value={device.area_um2} unit="µm²" onChange={area_um2 => updateDevice({ area_um2 })}/>}
            {depth >= 3 && <NumberField label={es?'Puntos de malla':'Mesh points'} value={experiment.numerics.mesh_points} unit={es?'nodos':'nodes'} step="1" onChange={mesh_points => setExperiment(e => ({...e, numerics: {...e.numerics, mesh_points}}))}/>}
          </div>
          {depth >= 3 && <div className="engine-select"><label>{es?'Motor de cálculo':'Calculation engine'}<select value={experiment.engine} onChange={e => setExperiment(x => ({...x, engine: e.target.value as Experiment['engine']}))}><option value="educational">{es?'Aproximación educativa':'Educational approximation'}</option><option value="devsim">DEVSIM ({es?'integración pendiente':'integration pending'})</option></select></label></div>}
          <button className="run" onClick={run} disabled={running}>{running ? (es?'Resolviendo…':'Solving…') : (es?'Ejecutar experimento':'Run experiment')} <span>→</span></button>
          {error && <p className="error">{error}</p>}
        </aside>

        <section className="results">
          <div className="panel-title"><div><span>02</span><h2>{es?'Interprete el dispositivo':'Read the device'}</h2></div><small className={result?.converged ? 'ok' : ''}>{result?.converged ? (es?'● RESUELTO':'● SOLVED') : (es?'○ LISTO':'○ READY')}</small></div>
          <div className="metrics">{result?.metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><b>{metric.value.toExponential(3)}</b><small>{metric.unit}</small></div>)}</div>
          <div className="plot-tabs">{[['potential',es?'Potencial':'Potential'],['electric_field',es?'Campo E':'E-field'],['charge_density',es?'Carga':'Charge'],['iv',es?'Curva I–V':'I–V curve']].map(([id,label]) => <button className={activePlot===id?'active':''} onClick={()=>setActivePlot(id)} key={id}>{label}</button>)}</div>
          <Plot series={selected} locale={locale}/>
          {depth >= 1 && result && <div className="explain"><span>{es?'POR QUÉ CAMBIA':'WHY IT MOVES'}</span><p>{result.explanations[activePlot === 'iv' ? 1 : 0]}</p></div>}
        </section>
      </section>

      {depth >= 3 && result && <section className="technical"><div><p className="eyebrow">{es?'TRANSPARENCIA DEL MODELO':'MODEL TRANSPARENCY'}</p><h2>{es?'Nada importante permanece oculto.':'Nothing important is hidden.'}</h2></div><dl><div><dt>{es?'Modelo':'Model'}</dt><dd>{result.provenance.model}</dd></div><div><dt>{es?'Autoridad':'Authority'}</dt><dd>{result.provenance.authoritative ? (es?'Motor validado':'Validated engine') : (es?'Educativo — no apto para sign-off':'Educational — not sign-off')}</dd></div><div><dt>{es?'Huella de entrada':'Input fingerprint'}</dt><dd className="mono">{result.provenance.input_sha256.slice(0, 20)}…</dd></div></dl></section>}
      {depth >= 4 && <section className="raw"><div><p className="eyebrow">{es?'MANIFIESTO REPRODUCIBLE':'REPRODUCIBLE MANIFEST'}</p><h2>{es?'Entrada exacta del experimento':'Exact experiment input'}</h2></div><pre>{JSON.stringify(experiment, null, 2)}</pre></section>}
    </main></> : <DesignStudio locale={locale}/>}
    <footer><span>{es?'CIENCIA ABIERTA · FIDELIDAD HONESTA · RESULTADOS REPRODUCIBLES':'OPEN SCIENCE · HONEST FIDELITY · REPRODUCIBLE RESULTS'}</span><a href="https://github.com/tono88/OpenSemiLab">GitHub ↗</a></footer>
  </div>
}

export default App
