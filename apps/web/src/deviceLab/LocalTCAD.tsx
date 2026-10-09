import { useEffect, useMemo, useState } from 'react'
import { compareBundles, devsimHealth, simulate, validateDevsim } from '../api'
import type { Experiment, SimulationResult, ValidationResult } from '../types'
import LabPlot, { number } from './LabPlot'
import { downloadFile } from './scientific'
import { text as t, type Config, type Locale } from './types'

export default function LocalTCAD({ config, locale }: { config: Config; locale: Locale }) {
  const es = locale === 'es', [online, setOnline] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [result, setResult] = useState<SimulationResult | null>(null), [validation, setValidation] = useState<ValidationResult | null>(null), [comparison, setComparison] = useState<Record<string, unknown> | null>(null)
  const [length, setLength] = useState(2), [mesh, setMesh] = useState(201), [active, setActive] = useState('potential')
  const experiment: Experiment = useMemo(() => ({ name: 'OpenSemiLab local PN reference', engine: 'devsim', device: { kind: 'pn_junction_1d', material: 'silicon', length_um: length, area_um2: config.parameters.area, acceptor_cm3: config.parameters.na, donor_cm3: config.parameters.nd, temperature_k: config.parameters.temperature }, sweep: { start_v: config.parameters.start, stop_v: config.parameters.stop, points: Math.min(201, config.points) }, numerics: { mesh_points: mesh, relative_tolerance: 1e-8, max_iterations: 80 } }), [config, length, mesh])
  const [usedInput, setUsedInput] = useState('')
  const stale = !!result && usedInput !== JSON.stringify(experiment)
  async function detect() { setOnline(await devsimHealth()) }
  useEffect(() => { void detect() }, [])
  async function run(validate: boolean) {
    setBusy(validate ? 'validation' : 'simulation'); setError(''); setComparison(null)
    try {
      if (validate) { const report = await validateDevsim(experiment); setValidation(report); setResult(report.result) }
      else { setResult(await simulate(experiment)); setValidation(null) }
      setUsedInput(JSON.stringify(experiment))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy('') }
  }
  async function compare(file: File) {
    try { if (!validation) throw new Error(es ? 'Ejecute primero la validación actual.' : 'Run current validation first.'); if (file.size > 5_000_000) throw new Error('JSON > 5 MB'); setComparison(await compareBundles(JSON.parse(await file.text()), validation.bundle)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const selected = result?.series.find(s => s.name === active) ?? result?.series[0]
  return <section className="dl-tcad">
    <div className="dl-section-title"><div><span>TCAD · DEVSIM · 1D</span><h3>{es ? 'Solver en su computador' : 'Solver on your computer'}</h3></div><small>{online ? (es ? 'LOCAL CONECTADO' : 'LOCAL CONNECTED') : (es ? 'LOCAL NO DETECTADO' : 'LOCAL NOT DETECTED')}</small></div>
    <p>{es ? 'Resuelve Poisson y continuidad de electrones/huecos en una unión PN de silicio. Los cálculos van directamente al companion 127.0.0.1:8787 de este computador. El catálogo analítico y DEVSIM son motores distintos, con supuestos distintos.' : 'Solves Poisson and electron/hole continuity for a silicon PN junction. Calculations go directly to the 127.0.0.1:8787 companion on this computer. The analytic catalogue and DEVSIM are distinct engines with distinct assumptions.'}</p>
    <div className="dl-inline-fields"><label>{es ? 'Longitud total' : 'Total length'} (µm)<input type="number" min=".1" max="100" step=".1" value={length} onChange={event => setLength(Number(event.target.value))}/></label><label>{es ? 'Nodos de malla' : 'Mesh nodes'}<select value={mesh} onChange={event => setMesh(Number(event.target.value))}>{[51, 101, 201, 501].map(value => <option key={value}>{value}</option>)}</select></label><button onClick={detect}>{es ? 'Detectar DEVSIM' : 'Detect DEVSIM'}</button><button disabled={!online || !!busy || !Number.isFinite(length) || length <= 0} onClick={() => run(false)}>{busy === 'simulation' ? (es ? 'Resolviendo…' : 'Solving…') : (es ? 'Ejecutar TCAD local' : 'Run local TCAD')}</button><button disabled={!online || !!busy} onClick={() => run(true)}>{busy === 'validation' ? (es ? 'Validando mallas…' : 'Validating meshes…') : (es ? 'Validar 51 / 101 / 201' : 'Validate 51 / 101 / 201')}</button></div>
    {!online && <div className="devsim-setup"><b>{es ? 'Instalación en el equipo cliente' : 'Installation on the client computer'}</b><code>python -m pip install ./services/devsim-worker</code><code>opensemilab-devsim</code><p>{es ? 'Ejecute desde una copia del repositorio en su computador. Autorice el origen del portal con OPENSEMILAB_ALLOWED_ORIGINS. Consulte los scripts de instalación local y docs/devsim-validation.md.' : 'Run from a repository copy on your computer. Allow the portal origin using OPENSEMILAB_ALLOWED_ORIGINS. See local installation scripts and docs/devsim-validation.md.'}</p></div>}
    {error && <p className="error" role="alert">{error}</p>}{stale && <p className="dl-notice">{es ? 'La configuración cambió; las curvas TCAD corresponden a la última ejecución.' : 'Configuration changed; TCAD curves belong to the last run.'}</p>}
    {result && <><div className="dl-metrics">{result.metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><b>{number(metric.value)}</b><small>{metric.unit}</small></div>)}</div><div className="dl-plot-tabs">{result.series.map(s => <button aria-pressed={s.name === selected?.name} key={s.name} onClick={() => setActive(s.name)}>{s.name}</button>)}</div><LabPlot locale={locale} provenance={{ ...result.provenance, input: usedInput ? JSON.parse(usedInput) : null, revision: result.provenance.engine_version, execution_host: 'local-companion' }} series={selected ? { ...selected, label: t(selected.y_label), explanation: t('Datos numéricos de DEVSIM local. La convergencia y las invariantes no establecen acuerdo con hardware medido.', 'Numerical local DEVSIM data. Convergence and invariants do not establish agreement with measured hardware.') } : undefined}/><p className="dl-caption">{result.provenance.engine} {result.provenance.engine_version} · {result.provenance.model} · SHA-256 {result.provenance.input_sha256}</p><button onClick={() => downloadFile('pn-local-devsim-result.json', JSON.stringify({ experiment: JSON.parse(usedInput), result }, null, 2))}>{es ? 'Exportar resultado TCAD' : 'Export TCAD result'}</button></>}
    {validation && <><ul className="dl-checks">{validation.checks.map(check => <li key={check.id} className={check.passed ? 'pass' : 'fail'}><b>{check.passed ? '✓' : '×'} {check.label}</b><span>{number(check.value)} / {number(check.limit)}</span></li>)}</ul><div className="dl-inline-fields"><button onClick={() => downloadFile('pn-devsim-validation.json', JSON.stringify(validation.bundle, null, 2))}>{es ? 'Exportar validación reproducible' : 'Export reproducible validation'}</button><label className="dl-upload">{es ? 'Comparar paquete TCAD anterior' : 'Compare previous TCAD bundle'}<input type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void compare(file); event.currentTarget.value = '' }}/></label></div>{comparison && <pre className="dl-json">{JSON.stringify(comparison, null, 2)}</pre>}</>}
    <p className="dl-caption">{es ? 'La validación conserva los límites de comparación analítica, convergencia de malla y conservación de corriente documentados. Para una investigación sobre un proceso real se necesitan modelos materiales, geometría y mediciones de referencia apropiados.' : 'Validation retains documented analytic-comparison, mesh-convergence and current-conservation limits. Research on a real process requires appropriate material models, geometry and reference measurements.'}</p>
  </section>
}
