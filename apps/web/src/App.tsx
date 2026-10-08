import { useEffect, useMemo, useState } from 'react'
import './devsim.css'
import { compareBundles, devsimHealth, simulate, validateDevsim } from './api'
import { Plot } from './Plot'
import DesignStudio from './DesignStudio'
import type { Experiment, Mode, SimulationResult, ValidationResult } from './types'
import StudyComparison from './StudyComparison'
import type { StudyRun } from './StudyComparison'

const MODES: Mode[] = ['Explore', 'Learn', 'Design', 'Advanced', 'Research']
const defaults: Experiment = {
  name: 'Silicon PN junction', engine: 'educational',
  device: { kind: 'pn_junction_1d', material: 'silicon', length_um: 2, area_um2: 100, acceptor_cm3: 1e16, donor_cm3: 1e16, temperature_k: 300 },
  sweep: { start_v: -0.5, stop_v: 0.7, points: 73 }, numerics: { mesh_points: 201, relative_tolerance: 1e-8, max_iterations: 80 },
}

function randomGenerator(seed:number) {
  let state=seed>>>0
  return ()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296}
}

function gaussian(random:()=>number) {
  return Math.sqrt(-2*Math.log(Math.max(random(),1e-12)))*Math.cos(2*Math.PI*random())
}

function boundedDoping(value:number) {return Math.max(1e12,Math.min(1e20,value))}

function displayNumber(value:number) {
  const magnitude=Math.abs(value)
  return value!==0&&(magnitude>=1e6||magnitude<1e-3)?value.toExponential(4):String(value)
}

function NumberField({ label, value, unit, onChange, step = 'any' }: { label: string; value: number; unit: string; onChange: (n: number) => void; step?: string }) {
  const [draft,setDraft]=useState(displayNumber(value))
  useEffect(()=>setDraft(displayNumber(value)),[value])
  function commit(raw:string) { const parsed=Number(raw); if(Number.isFinite(parsed)){onChange(parsed);setDraft(displayNumber(parsed))} else setDraft(displayNumber(value)) }
  return <label className="field"><span>{label}</span><div><input type="text" inputMode="decimal" value={draft} data-step={step} onChange={e=>setDraft(e.target.value)} onBlur={e=>commit(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')commit(e.currentTarget.value)}}/><b>{unit}</b></div></label>
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
  const [studyRunning,setStudyRunning]=useState<'corners'|'montecarlo'|''>('')
  const [studyType,setStudyType]=useState<'corners'|'montecarlo'>('corners')
  const [studyRuns,setStudyRuns]=useState<StudyRun[]>([])
  const [error, setError] = useState('')
  const [devsimOnline,setDevsimOnline]=useState(false)
  const [validation,setValidation]=useState<ValidationResult|null>(null)
  const [validating,setValidating]=useState(false)
  const [comparison,setComparison]=useState<Record<string,unknown>|null>(null)
  const depth = MODES.indexOf(mode)
  const modeLabels: Record<Mode,string> = es
    ? {Explore:'Explorar',Learn:'Aprender',Design:'Diseñar',Advanced:'Avanzado',Research:'Investigación'}
    : {Explore:'Explore',Learn:'Learn',Design:'Design',Advanced:'Advanced',Research:'Research'}

  function changeLocale(next:'es'|'en') { setLocale(next); localStorage.setItem('opensemilab.locale',next) }

  async function refreshDevsim() { setDevsimOnline(await devsimHealth()) }

  async function run() {
    setRunning(true); setError('')
    try { setResult(await simulate(experiment)) } catch (e) { setError(e instanceof Error ? e.message : (es?'La simulación falló':'Simulation failed')) }
    finally { setRunning(false) }
  }

  async function validateLocal() {
    setValidating(true);setError('')
    try { const report=await validateDevsim(experiment);setValidation(report);setResult(report.result) }
    catch(e) {setError(e instanceof Error?e.message:(es?'La validación falló':'Validation failed'))}
    finally {setValidating(false)}
  }

  function downloadBundle() {
    if(!validation)return
    const blob=new Blob([JSON.stringify(validation.bundle,null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob);const link=document.createElement('a')
    link.href=url;link.download=`opensemilab-devsim-${validation.bundle.bundle_sha256.slice(0,12)}.json`;link.click();URL.revokeObjectURL(url)
  }

  function downloadCsv() {
    if(!result)return
    const series=result.series.find(item=>item.name===activePlot)
    if(!series)return
    const rows:(string|number)[][]=[[`${series.x_label} (${series.x_unit})`,`${series.y_label} (${series.y_unit})`],...series.x.map((x,index)=>[x,series.y[index]])]
    const csv=rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\n')
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a')
    link.href=url;link.download=`${activePlot}.csv`;link.click();URL.revokeObjectURL(url)
  }

  async function importAndCompare(file:File) {
    if(!validation){setError(es?'Primero ejecute la validación actual.':'Run the current validation first.');return}
    try {
      const imported=JSON.parse(await file.text()) as Record<string,unknown>
      setComparison(await compareBundles(imported,validation.bundle))
    } catch(e) {setError(e instanceof Error?e.message:(es?'Paquete inválido':'Invalid bundle'))}
  }

  async function runStudy(type:'corners'|'montecarlo') {
    setStudyRunning(type);setError('')
    try {
      const scenarios:{label:string;experiment:Experiment}[]=[]
      if(type==='corners') {
        const variants=[
          ['Nominal',1,experiment.device.temperature_k],
          ['Doping −10%',.9,experiment.device.temperature_k],
          ['Doping +10%',1.1,experiment.device.temperature_k],
          ['Cold',1,Math.max(150,experiment.device.temperature_k-50)],
          ['Hot',1,Math.min(600,experiment.device.temperature_k+100)],
        ] as const
        variants.forEach(([label,factor,temperature])=>scenarios.push({label,experiment:{...experiment,name:`${experiment.name} · ${label}`,device:{...experiment.device,acceptor_cm3:boundedDoping(experiment.device.acceptor_cm3*factor),donor_cm3:boundedDoping(experiment.device.donor_cm3*factor),temperature_k:temperature}}}))
      } else {
        const random=randomGenerator(0x5eED2026)
        for(let index=0;index<20;index+=1) scenarios.push({label:`MC ${String(index+1).padStart(2,'0')}`,experiment:{...experiment,name:`${experiment.name} · MC ${index+1}`,device:{...experiment.device,acceptor_cm3:boundedDoping(experiment.device.acceptor_cm3*Math.exp(.08*gaussian(random))),donor_cm3:boundedDoping(experiment.device.donor_cm3*Math.exp(.08*gaussian(random))),temperature_k:Math.max(150,Math.min(600,experiment.device.temperature_k+5*gaussian(random)))}}})
      }
      const results=await Promise.all(scenarios.map(async scenario=>({label:scenario.label,result:await simulate(scenario.experiment)})))
      setStudyType(type);setStudyRuns(results)
    } catch(reason) {setError(reason instanceof Error?reason.message:(es?'El estudio falló':'Study failed'))}
    finally {setStudyRunning('')}
  }
  useEffect(() => { void run(); void refreshDevsim() }, [])
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
          {depth >= 3 && <div className="engine-select"><label>{es?'Motor de cálculo':'Calculation engine'}<select value={experiment.engine} onChange={e => setExperiment(x => ({...x, engine: e.target.value as Experiment['engine']}))}><option value="educational">{es?'Aproximación educativa':'Educational approximation'}</option><option value="devsim">DEVSIM ({devsimOnline?(es?'local conectado':'local connected'):(es?'requiere instalación local':'local install required')})</option></select></label></div>}
          {depth>=3&&experiment.engine==='devsim'&&!devsimOnline&&<div className="devsim-setup"><b>{es?'Conecte DEVSIM en este equipo':'Connect DEVSIM on this computer'}</b><p>{es?'Los cálculos se ejecutan localmente; sólo los resultados llegan al navegador.':'Calculations run locally; only results reach the browser.'}</p><code>python -m pip install ./services/devsim-worker</code><code>opensemilab-devsim</code><button onClick={refreshDevsim}>{es?'Volver a detectar':'Detect again'}</button></div>}
          <button className="run" onClick={run} disabled={running}>{running ? (es?'Resolviendo…':'Solving…') : (es?'Ejecutar experimento':'Run experiment')} <span>→</span></button>
          {depth>=4&&experiment.engine==='devsim'&&devsimOnline&&<button className="validate" onClick={validateLocal} disabled={validating}>{validating?(es?'Validando 3 mallas…':'Validating 3 meshes…'):(es?'Validar DEVSIM (51 / 101 / 201)':'Validate DEVSIM (51 / 101 / 201)')}</button>}
          {error && <p className="error">{error}</p>}
        </aside>

        <section className="results">
          <div className="panel-title"><div><span>02</span><h2>{es?'Interprete el dispositivo':'Read the device'}</h2></div><small className={result?.converged ? 'ok' : ''}>{result?.converged ? (es?'● RESUELTO':'● SOLVED') : (es?'○ LISTO':'○ READY')}</small></div>
          <div className="metrics">{result?.metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><b>{metric.value.toExponential(3)}</b><small>{metric.unit}</small></div>)}</div>
          <div className="plot-tabs">{[['potential',es?'Potencial':'Potential'],['electric_field',es?'Campo E':'E-field'],['charge_density',es?'Carga':'Charge'],['iv',es?'Curva I–V':'I–V curve']].map(([id,label]) => <button className={activePlot===id?'active':''} onClick={()=>setActivePlot(id)} key={id}>{label}</button>)}</div>
          <Plot series={selected} locale={locale}/>
          {depth>=2&&<div className="study-actions"><div><span>{es?'ESTUDIOS PARAMÉTRICOS':'PARAMETRIC STUDIES'}</span><small>{es?'Corners educativos y Monte Carlo reproducible':'Educational corners and reproducible Monte Carlo'}</small></div><button disabled={!!studyRunning} onClick={()=>runStudy('corners')}>{studyRunning==='corners'?(es?'Calculando…':'Calculating…'):(es?'Ejecutar corners':'Run corners')}</button><button disabled={!!studyRunning} onClick={()=>runStudy('montecarlo')}>{studyRunning==='montecarlo'?(es?'Muestreando…':'Sampling…'):(es?'Monte Carlo ×20':'Monte Carlo ×20')}</button></div>}
          {depth >= 1 && result && <div className="explain"><span>{es?'POR QUÉ CAMBIA':'WHY IT MOVES'}</span><p>{result.explanations[activePlot === 'iv' ? 1 : 0]}</p></div>}
        </section>
      </section>

      {studyRuns.length>0&&<StudyComparison runs={studyRuns} type={studyType} seriesName={activePlot} locale={locale}/>}

      {depth>=4&&validation&&<section className="validation-report"><div><p className="eyebrow">DEVSIM / VALIDATION</p><h2>{validation.passed?(es?'Validación aprobada':'Validation passed'):(es?'Validación requiere atención':'Validation needs attention')}</h2></div><div>{validation.checks.map(check=><p key={check.id} className={check.passed?'pass':'fail'}><b>{check.passed?'✓':'×'} {check.label}</b><span>{check.value.toExponential(3)} / {check.limit.toExponential(1)}</span></p>)}<div className="bundle-actions"><button onClick={downloadBundle}>{es?'Descargar JSON':'Download JSON'}</button><button onClick={downloadCsv}>{es?'Descargar CSV visible':'Download plotted CSV'}</button><label>{es?'Importar y comparar':'Import and compare'}<input type="file" accept="application/json,.json" onChange={event=>{const file=event.target.files?.[0];if(file)void importAndCompare(file)}}/></label></div>{comparison&&<pre>{JSON.stringify(comparison,null,2)}</pre>}</div></section>}

      {depth >= 3 && result && <section className="technical"><div><p className="eyebrow">{es?'TRANSPARENCIA DEL MODELO':'MODEL TRANSPARENCY'}</p><h2>{es?'Nada importante permanece oculto.':'Nothing important is hidden.'}</h2></div><dl><div><dt>{es?'Modelo':'Model'}</dt><dd>{result.provenance.model}</dd></div><div><dt>{es?'Autoridad':'Authority'}</dt><dd>{result.provenance.authoritative ? (es?'Motor validado':'Validated engine') : (es?'Educativo — no apto para sign-off':'Educational — not sign-off')}</dd></div><div><dt>{es?'Huella de entrada':'Input fingerprint'}</dt><dd className="mono">{result.provenance.input_sha256.slice(0, 20)}…</dd></div></dl></section>}
      {depth >= 4 && <section className="raw"><div><p className="eyebrow">{es?'MANIFIESTO REPRODUCIBLE':'REPRODUCIBLE MANIFEST'}</p><h2>{es?'Entrada exacta del experimento':'Exact experiment input'}</h2></div><pre>{JSON.stringify(experiment, null, 2)}</pre></section>}
    </main></> : <DesignStudio locale={locale}/>}
    <footer><span>{es?'DEL RTL AL SILICIO · FLUJOS EDA ABIERTOS · DISEÑO VERIFICABLE':'RTL TO SILICON · OPEN EDA FLOWS · VERIFIABLE DESIGN'}</span></footer>
  </div>
}

export default App
