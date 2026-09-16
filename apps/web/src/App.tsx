import { useEffect, useMemo, useState } from 'react'
import { simulate } from './api'
import { Plot } from './Plot'
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
  const [mode, setMode] = useState<Mode>('Explore')
  const [experiment, setExperiment] = useState(defaults)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [activePlot, setActivePlot] = useState('potential')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const depth = MODES.indexOf(mode)

  async function run() {
    setRunning(true); setError('')
    try { setResult(await simulate(experiment)) } catch (e) { setError(e instanceof Error ? e.message : 'Simulation failed') }
    finally { setRunning(false) }
  }
  useEffect(() => { void run() }, [])
  const selected = useMemo(() => result?.series.find(s => s.name === activePlot), [result, activePlot])
  const device = experiment.device
  const updateDevice = (patch: Partial<Experiment['device']>) => setExperiment(e => ({ ...e, device: { ...e.device, ...patch } }))

  return <div className="app-shell">
    <header><div className="brand"><div className="mark">OS</div><div><strong>OpenSemiLab</strong><small>Semiconductor laboratory</small></div></div><div className="engine"><i/> Educational engine <span>v0.1</span></div></header>
    <nav className="modes" aria-label="Interface depth">
      {MODES.map((item, i) => <button className={mode === item ? 'active' : ''} onClick={() => setMode(item)} key={item}><em>0{i + 1}</em>{item}</button>)}
    </nav>

    <main>
      <section className="intro"><div><p className="eyebrow">DEVICE LAB / PN JUNCTION</p><h1>See what happens<br/><span>inside the silicon.</span></h1><p>Change the material conditions. Run the model. Connect every curve to the physics beneath it.</p></div><div className="status-card"><span>DEPTH</span><b>{mode}</b><p>{depth < 2 ? 'Guided controls with scientific terms introduced in context.' : 'Engineering controls and complete model provenance.'}</p></div></section>

      <section className="workspace">
        <aside className="controls">
          <div className="panel-title"><div><span>01</span><h2>Build the junction</h2></div><small>Silicon · 1D</small></div>
          <div className="junction" aria-label="PN junction diagram"><div className="p"><b>P</b><small>acceptors</small></div><div className="depletion"><span>depletion</span></div><div className="n"><b>N</b><small>donors</small></div></div>
          <div className="control-grid">
            <NumberField label="P-side doping" value={device.acceptor_cm3} unit="cm⁻³" onChange={acceptor_cm3 => updateDevice({ acceptor_cm3 })}/>
            <NumberField label="N-side doping" value={device.donor_cm3} unit="cm⁻³" onChange={donor_cm3 => updateDevice({ donor_cm3 })}/>
            <NumberField label="Temperature" value={device.temperature_k} unit="K" step="1" onChange={temperature_k => updateDevice({ temperature_k })}/>
            {depth >= 2 && <NumberField label="Device length" value={device.length_um} unit="µm" onChange={length_um => updateDevice({ length_um })}/>} 
            {depth >= 2 && <NumberField label="Junction area" value={device.area_um2} unit="µm²" onChange={area_um2 => updateDevice({ area_um2 })}/>} 
            {depth >= 3 && <NumberField label="Mesh points" value={experiment.numerics.mesh_points} unit="nodes" step="1" onChange={mesh_points => setExperiment(e => ({...e, numerics: {...e.numerics, mesh_points}}))}/>} 
          </div>
          {depth >= 3 && <div className="engine-select"><label>Calculation engine<select value={experiment.engine} onChange={e => setExperiment(x => ({...x, engine: e.target.value as Experiment['engine']}))}><option value="educational">Educational approximation</option><option value="devsim">DEVSIM (integration pending)</option></select></label></div>}
          <button className="run" onClick={run} disabled={running}>{running ? 'Solving…' : 'Run experiment'} <span>→</span></button>
          {error && <p className="error">{error}</p>}
        </aside>

        <section className="results">
          <div className="panel-title"><div><span>02</span><h2>Read the device</h2></div><small className={result?.converged ? 'ok' : ''}>{result?.converged ? '● SOLVED' : '○ READY'}</small></div>
          <div className="metrics">{result?.metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><b>{metric.value.toExponential(3)}</b><small>{metric.unit}</small></div>)}</div>
          <div className="plot-tabs">{[['potential','Potential'],['electric_field','E-field'],['charge_density','Charge'],['iv','I–V curve']].map(([id,label]) => <button className={activePlot===id?'active':''} onClick={()=>setActivePlot(id)} key={id}>{label}</button>)}</div>
          <Plot series={selected}/>
          {depth >= 1 && result && <div className="explain"><span>WHY IT MOVES</span><p>{result.explanations[activePlot === 'iv' ? 1 : 0]}</p></div>}
        </section>
      </section>

      {depth >= 3 && result && <section className="technical"><div><p className="eyebrow">MODEL TRANSPARENCY</p><h2>Nothing important is hidden.</h2></div><dl><div><dt>Model</dt><dd>{result.provenance.model}</dd></div><div><dt>Authority</dt><dd>{result.provenance.authoritative ? 'Validated engine' : 'Educational — not sign-off'}</dd></div><div><dt>Input fingerprint</dt><dd className="mono">{result.provenance.input_sha256.slice(0, 20)}…</dd></div></dl></section>}
      {depth >= 4 && <section className="raw"><div><p className="eyebrow">REPRODUCIBLE MANIFEST</p><h2>Exact experiment input</h2></div><pre>{JSON.stringify(experiment, null, 2)}</pre></section>}
    </main>
    <footer><span>OPEN SCIENCE · HONEST FIDELITY · REPRODUCIBLE RESULTS</span><a href="https://github.com/tono88/OpenSemiLab">GitHub ↗</a></footer>
  </div>
}

export default App
