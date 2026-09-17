import { useEffect, useMemo, useState } from 'react'
import type { ProjectFile, StoredProject } from './projectStore'

interface Artifact { name:string;media_type:string;content:string;encoding?:'utf-8'|'base64';size_bytes?:number }
interface RunResult { job_id:string; engine:string; success:boolean; exit_code:number; output:string; duration_ms:number; artifacts:Artifact[];pdk?:string;scl?:string }

type ArtifactKind='layout'|'netlist'|'timing'|'report'|'configuration'|'other'

function artifactKind(name:string):ArtifactKind {
  const lower=name.toLowerCase()
  if(['.gds','.def','.lef'].some(extension=>lower.endsWith(extension))) return 'layout'
  if(['.sdf','.sdc','.spef'].some(extension=>lower.endsWith(extension))) return 'timing'
  if(['.v','.sv'].some(extension=>lower.endsWith(extension))) return 'netlist'
  if(['.rpt','.log','.csv'].some(extension=>lower.endsWith(extension))) return 'report'
  if(lower.endsWith('.json')) return 'configuration'
  return 'other'
}

function formatBytes(bytes:number|undefined) {
  if(bytes===undefined) return '—'
  if(bytes<1024) return `${bytes} B`
  if(bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`
  return `${(bytes/(1024*1024)).toFixed(1)} MB`
}

function ArtifactBrowser({artifacts,locale,onDownload}:{artifacts:Artifact[];locale:'es'|'en';onDownload:(artifact:Artifact)=>void}) {
  const es=locale==='es'
  const [filter,setFilter]=useState<'all'|ArtifactKind>('all')
  const kinds:ArtifactKind[]=['layout','netlist','timing','report','configuration','other']
  const labels:Record<ArtifactKind,string>=es
    ? {layout:'Layout',netlist:'Netlists',timing:'Temporización',report:'Reportes',configuration:'Configuración',other:'Otros'}
    : {layout:'Layout',netlist:'Netlists',timing:'Timing',report:'Reports',configuration:'Configuration',other:'Other'}
  const counts=Object.fromEntries(kinds.map(kind=>[kind,artifacts.filter(artifact=>artifactKind(artifact.name)===kind).length])) as Record<ArtifactKind,number>
  const effectiveFilter=filter==='all'||counts[filter]>0?filter:'all'
  const shown=effectiveFilter==='all'?artifacts:artifacts.filter(artifact=>artifactKind(artifact.name)===effectiveFilter)
  const totalBytes=artifacts.reduce((sum,artifact)=>sum+(artifact.size_bytes??0),0)

  return <section className="artifact-browser">
    <div className="artifact-heading"><div><span>{es?'RESULTADOS GENERADOS':'GENERATED OUTPUTS'}</span><b>{artifacts.length} {es?'archivos':'files'} · {formatBytes(totalBytes)}</b></div><small>{es?'Seleccione un archivo para descargarlo':'Select a file to download it'}</small></div>
    <div className="artifact-filters"><button className={effectiveFilter==='all'?'active':''} onClick={()=>setFilter('all')}>{es?'Todos':'All'} <b>{artifacts.length}</b></button>{kinds.filter(kind=>counts[kind]>0).map(kind=><button className={effectiveFilter===kind?'active':''} onClick={()=>setFilter(kind)} key={kind}>{labels[kind]} <b>{counts[kind]}</b></button>)}</div>
    <div className="artifact-grid">{shown.map(artifact=>{
      const parts=artifact.name.split('/');const filename=parts.pop()??artifact.name;const path=parts.join('/')||'output';const kind=artifactKind(artifact.name);const extension=filename.includes('.')?filename.split('.').pop()?.toUpperCase():'FILE'
      return <button className={`artifact-card kind-${kind}`} key={artifact.name} onClick={()=>onDownload(artifact)} title={`${es?'Descargar':'Download'} ${artifact.name}`}><span className="artifact-card-top"><i>{labels[kind]}</i><em>{extension}</em></span><strong>{filename}</strong><small>{path}</small><span className="artifact-card-meta"><i>{formatBytes(artifact.size_bytes)}</i><b aria-hidden="true">↓</b></span></button>
    })}</div>
  </section>
}

const HDL_EXTENSIONS=['.sv','.v']
const SPICE_EXTENSIONS=['.spice','.cir','.ckt','.lib']
type Action='lint'|'simulate'|'synthesize'|'spice'
interface ToolState { available:boolean }

const EXECUTION_DEFAULTS:Record<string,{rtlTop?:string;testbenchTop?:string;spiceEntry?:string}>={
  microcontroller:{rtlTop:'top',testbenchTop:'tb_top'},
  fpga_prototype:{rtlTop:'top',testbenchTop:'tb_top'},
  sensor_interface:{rtlTop:'sensor_ctrl',testbenchTop:'tb_sensor_ctrl',spiceEntry:'analog/afe.spice'},
  analog_block:{spiceEntry:'simulation/testbench.spice'},
  standard_cell:{rtlTop:'inverter',testbenchTop:'tb_inverter',spiceEntry:'simulation/tb_inverter.spice'},
}

function readManifest(project:StoredProject):Record<string,any> {
  try {return JSON.parse(project.files.find(file=>file.path==='project.json')?.content??'{}')}
  catch {return {}}
}

export default function ProjectWorkspace({project,locale,onChange,onClose}:{project:StoredProject;locale:'es'|'en';onChange:(project:StoredProject)=>void;onClose:()=>void}) {
  const es=locale==='es'
  const initialManifest=readManifest(project)
  const initialPhysical=initialManifest.physical??{}
  const initial=project.files.find(file=>file.path==='rtl/top.sv')?.path??project.files[0]?.path??''
  const [selectedPath,setSelectedPath]=useState(initial)
  const [running,setRunning]=useState('')
  const [result,setResult]=useState<RunResult|null>(null)
  const [error,setError]=useState('')
  const [tools,setTools]=useState<Record<string,ToolState>>({})
  const [worker,setWorker]=useState<'checking'|'online'|'degraded'|'offline'>('checking')
  const [clockPort,setClockPort]=useState(String(initialPhysical.clock_port??'clk'))
  const [clockPeriod,setClockPeriod]=useState(Number(initialPhysical.clock_period_ns??10))
  const [dieWidth,setDieWidth]=useState(Number(initialPhysical.die_width_um??120))
  const [dieHeight,setDieHeight]=useState(Number(initialPhysical.die_height_um??120))
  const [utilization,setUtilization]=useState(Number(initialPhysical.core_utilization_pct??40))
  const [physicalStatus,setPhysicalStatus]=useState('')
  const selected=project.files.find(file=>file.path===selectedPath)??project.files[0]
  const execution=useMemo(()=>{
    const fallback=EXECUTION_DEFAULTS[project.kind]??{}
    const manifest=project.files.find(file=>file.path==='project.json')
    try {
      const parsed=JSON.parse(manifest?.content??'{}').execution??{}
      return {rtlTop:parsed.rtl_top??fallback.rtlTop,testbenchTop:parsed.testbench_top??fallback.testbenchTop,spiceEntry:parsed.spice_entry??fallback.spiceEntry}
    } catch { return fallback }
  },[project.kind,project.files])
  const hdlSources=project.files.filter(file=>HDL_EXTENSIONS.some(ext=>file.path.endsWith(ext)))
  const rtlSources=hdlSources.filter(file=>file.role==='source')
  const testbenches=hdlSources.filter(file=>file.role==='testbench')
  const spiceSources=project.files.filter(file=>SPICE_EXTENSIONS.some(ext=>file.path.toLowerCase().endsWith(ext)))
  const spiceEntry=spiceSources.find(file=>file.path===execution.spiceEntry)??spiceSources.find(file=>file.role==='testbench')??spiceSources[0]
  const groups=useMemo(()=>{
    const grouped:Record<string,ProjectFile[]>={}
    project.files.forEach(file=>{const group=file.path.includes('/')?file.path.split('/')[0]:'project';(grouped[group]??=[]).push(file)})
    return grouped
  },[project.files])

  async function refreshCapabilities() {
    setWorker('checking')
    try {
      const response=await fetch('/api/v1/eda/capabilities')
      if(!response.ok) throw new Error()
      const body=await response.json();setTools(body.tools??{});setWorker(body.ready?'online':'degraded')
    } catch {setWorker('offline')}
  }
  useEffect(()=>{void refreshCapabilities()},[])

  function updateFile(content:string) {
    onChange({...project,updatedAt:new Date().toISOString(),files:project.files.map(file=>file.path===selected.path?{...file,content}:file)})
  }

  function addFile() {
    const path=window.prompt(es?'Ruta del archivo nuevo (ej. rtl/uart.sv)':'New file path (for example rtl/uart.sv)')?.trim()
    if(!path||project.files.some(file=>file.path===path)||path.startsWith('/')||path.includes('..')) return
    const extension=path.split('.').pop()
    const role:ProjectFile['role']=extension==='sv'||extension==='v'?'source':'documentation'
    onChange({...project,updatedAt:new Date().toISOString(),files:[...project.files,{path,role,content:''}]})
    setSelectedPath(path)
  }

  function removeFile() {
    if(!selected||project.files.length===1||!window.confirm(es?`¿Eliminar ${selected.path}?`:`Delete ${selected.path}?`)) return
    const files=project.files.filter(file=>file.path!==selected.path)
    onChange({...project,updatedAt:new Date().toISOString(),files})
    setSelectedPath(files[0].path)
  }

  function exportProject() {
    const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${project.name.replace(/[^A-Za-z0-9_-]+/g,'_')}.opensemilab.json`;link.click();URL.revokeObjectURL(url)
  }

  async function run(action:Action) {
    setRunning(action);setError('');setResult(null)
    const relevant=action==='spice'?spiceSources:(action==='simulate'?[...rtlSources,...testbenches]:rtlSources)
    const sources=Object.fromEntries(relevant.map(file=>[file.path,file.content]))
    try {
      if(action==='simulate'&&!testbenches.length) throw new Error(es?'Agregue un archivo con rol testbench antes de simular.':'Add a file with the testbench role before simulation.')
      if(action==='spice'&&!spiceEntry) throw new Error(es?'Este proyecto no contiene un netlist SPICE ejecutable.':'This project does not contain an executable SPICE netlist.')
      const top=action==='simulate'?execution.testbenchTop:execution.rtlTop
      const response=await fetch('/api/v1/eda/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,top:top??'top',entry:action==='spice'?spiceEntry?.path:undefined,sources})})
      const data=await response.json();if(!response.ok) throw new Error(data.detail??'EDA execution failed');setResult(data)
    } catch(reason) {setError(reason instanceof Error?reason.message:'EDA execution failed')}
    finally {setRunning('')}
  }

  async function runPhysical() {
    setRunning('physical');setPhysicalStatus(es?'Enviando trabajo…':'Submitting job…');setError('');setResult(null)
    const sources=Object.fromEntries(rtlSources.map(file=>[file.path,file.content]))
    const physical={pdk:project.pdk,clock_port:clockPort,clock_period_ns:clockPeriod,die_width_um:dieWidth,die_height_um:dieHeight,core_utilization_pct:utilization}
    const currentManifest=readManifest(project)
    onChange({...project,updatedAt:new Date().toISOString(),files:project.files.map(file=>file.path==='project.json'?{...file,content:JSON.stringify({...currentManifest,physical},null,2)+'\n'}:file)})
    try {
      const response=await fetch('/api/v1/eda/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        action:'physical',top:execution.rtlTop??'top',sources,
        physical,
      })})
      const created=await response.json();if(!response.ok) throw new Error(created.detail??'Could not start physical implementation')
      setPhysicalStatus(`${es?'Trabajo':'Job'} ${created.job_id} · ${es?'en cola':'queued'}`)
      for(let attempt=0;attempt<900;attempt+=1) {
        await new Promise(resolve=>window.setTimeout(resolve,2000))
        const statusResponse=await fetch(`/api/v1/eda/jobs/${created.job_id}`)
        const job=await statusResponse.json();if(!statusResponse.ok) throw new Error(job.detail??'Could not read physical job')
        setPhysicalStatus(`${es?'Trabajo':'Job'} ${created.job_id} · ${job.status}`)
        if(job.status==='completed') {setResult(job.result);return}
        if(job.status==='failed') {if(job.result)setResult(job.result);else throw new Error(job.error??'Physical implementation failed');return}
      }
      throw new Error(es?'La implementación superó el tiempo de seguimiento de 30 minutos.':'Implementation exceeded the 30-minute tracking window.')
    } catch(reason) {setError(reason instanceof Error?reason.message:'Physical implementation failed')}
    finally {setRunning('')}
  }

  function downloadArtifact(artifact:Artifact) {
    let payload:BlobPart=artifact.content
    if(artifact.encoding==='base64') {
      const binary=atob(artifact.content);const bytes=new Uint8Array(binary.length)
      for(let index=0;index<binary.length;index+=1) bytes[index]=binary.charCodeAt(index)
      payload=bytes
    }
    const url=URL.createObjectURL(new Blob([payload],{type:artifact.media_type}));const link=document.createElement('a');link.href=url;link.download=artifact.name.split('/').pop()??artifact.name;link.click();URL.revokeObjectURL(url)
  }

  return <section className="project-workspace">
    <div className="project-toolbar"><div><span>{es?'PROYECTO ACTIVO':'ACTIVE PROJECT'}</span><h2>{project.name}</h2><small>{project.kind} · {project.pdk} · {es?'guardado automático en este navegador':'autosaved in this browser'}</small></div><div><button onClick={exportProject}>{es?'Exportar':'Export'}</button><button onClick={onClose}>{es?'Cerrar':'Close'}</button></div></div>
    <div className={`workspace-worker ${worker}`}><i/>{worker==='online'?(es?'IIC-OSIC listo para ejecutar':'IIC-OSIC ready to run'):worker==='degraded'?(es?'Worker conectado; algunas herramientas no están disponibles':'Worker connected; some tools are unavailable'):worker==='checking'?(es?'Comprobando herramientas…':'Checking tools…'):(es?'Worker desconectado':'Worker offline')}<button onClick={refreshCapabilities}>{es?'Comprobar':'Check'}</button></div>
    <div className="project-grid">
      <aside className="file-tree"><div><b>{es?'ARCHIVOS':'FILES'}</b><button onClick={addFile}>＋</button></div>{Object.entries(groups).map(([group,files])=><section key={group}><span>{group}</span>{files.map(file=><button className={file.path===selected?.path?'active':''} onClick={()=>setSelectedPath(file.path)} key={file.path}>{file.path.split('/').pop()}</button>)}</section>)}</aside>
      <div className="file-editor"><div><span>{selected?.path}</span><i>{selected?.role}</i><button onClick={removeFile}>{es?'Eliminar':'Delete'}</button></div><textarea value={selected?.content??''} onChange={event=>updateFile(event.target.value)} spellCheck={false}/></div>
    </div>
    {(rtlSources.length||spiceSources.length)?<div className="execution-panel"><div><b>{es?'EJECUCIÓN DEL PROYECTO':'PROJECT EXECUTION'}</b><small>{execution.rtlTop?`RTL top: ${execution.rtlTop}`:''}{execution.spiceEntry?` · SPICE: ${execution.spiceEntry}`:''}</small></div><div className="project-actions">{rtlSources.length>0&&<button disabled={!!running||worker==='offline'||!(tools.verible_lint?.available||tools.verilator?.available)} onClick={()=>run('lint')}>01 · {running==='lint'?(es?'Ejecutando…':'Running…'):(es?'Analizar RTL':'Lint RTL')}<small>{tools.verible_lint?.available?'Verible':'Verilator'}</small></button>}{testbenches.length>0&&<button disabled={!!running||worker==='offline'||!(tools.iverilog?.available&&tools.vvp?.available)} onClick={()=>run('simulate')}>02 · {running==='simulate'?(es?'Ejecutando…':'Running…'):(es?'Simular RTL':'Simulate RTL')}<small>Icarus Verilog</small></button>}{rtlSources.length>0&&<button disabled={!!running||worker==='offline'||!tools.yosys?.available} onClick={()=>run('synthesize')}>03 · {running==='synthesize'?(es?'Ejecutando…':'Running…'):(es?'Sintetizar':'Synthesize')}<small>Yosys</small></button>}{spiceEntry&&<button disabled={!!running||worker==='offline'||!tools.ngspice?.available} onClick={()=>run('spice')}>04 · {running==='spice'?(es?'Ejecutando…':'Running…'):(es?'Simular SPICE':'Simulate SPICE')}<small>ngspice</small></button>}</div></div>:<div className="adapter-message">{es?'Este proyecto aún no contiene archivos ejecutables.':'This project does not contain executable files yet.'}</div>}
    {rtlSources.length>0&&['sky130A','gf180mcuD'].includes(project.pdk)&&<div className="physical-panel"><div className="physical-heading"><span>05</span><div><b>{es?'IMPLEMENTACIÓN FÍSICA RTL → GDSII':'PHYSICAL IMPLEMENTATION RTL → GDSII'}</b><small>{es?'LibreLane coordina Yosys, OpenROAD, OpenSTA y verificación física.':'LibreLane orchestrates Yosys, OpenROAD, OpenSTA and physical verification.'}</small></div></div><div className="physical-steps">{['Synthesis','Floorplan','Placement','CTS','Routing','Sign-off'].map((stage,index)=><i className={running==='physical'?'active':result?.engine==='LibreLane/OpenROAD'&&result.success?'done':''} key={stage}><span>{String(index+1).padStart(2,'0')}</span>{stage}</i>)}</div><div className="physical-config"><label>{es?'Puerto de reloj':'Clock port'}<input value={clockPort} onChange={event=>setClockPort(event.target.value)}/></label><label>{es?'Período (ns)':'Period (ns)'}<input type="number" min="0.1" max="1000" step="0.1" value={clockPeriod} onChange={event=>setClockPeriod(Number(event.target.value))}/></label><label>{es?'Ancho del dado (µm)':'Die width (µm)'}<input type="number" min="30" max="5000" value={dieWidth} onChange={event=>setDieWidth(Number(event.target.value))}/></label><label>{es?'Alto del dado (µm)':'Die height (µm)'}<input type="number" min="30" max="5000" value={dieHeight} onChange={event=>setDieHeight(Number(event.target.value))}/></label><label>{es?'Utilización del núcleo (%)':'Core utilization (%)'}<input type="number" min="5" max="80" value={utilization} onChange={event=>setUtilization(Number(event.target.value))}/></label><button disabled={!!running||worker==='offline'||!tools.librelane?.available} onClick={runPhysical}>{running==='physical'?(es?'Implementando…':'Implementing…'):(es?'Ejecutar RTL → GDSII':'Run RTL → GDSII')}<small>{tools.librelane?.available?'LibreLane Classic':(es?'No disponible':'Unavailable')}</small></button></div>{physicalStatus&&<p className="physical-status">{physicalStatus}</p>}</div>}
    {error&&<p className="error">{error}</p>}
    {result&&<div className="console"><div className="console-header"><span>{result.engine} · {result.duration_ms} ms{result.pdk?` · ${result.pdk}`:''}{result.scl?` / ${result.scl}`:''}</span><b className={result.success?'success':'failed'}>{result.success?(es?'CORRECTO':'PASSED'):(es?'FALLÓ':'FAILED')} · EXIT {result.exit_code}</b></div><details className="console-output" open={!result.success}><summary>{es?'Registro de ejecución':'Execution log'} <span>{result.output?`${result.output.split('\n').length} ${es?'líneas':'lines'}`:(es?'sin salida':'no output')}</span></summary><pre>{result.output||(es?'La herramienta terminó sin salida de consola.':'The tool completed without console output.')}</pre></details>{result.artifacts.length>0&&<ArtifactBrowser artifacts={result.artifacts} locale={locale} onDownload={downloadArtifact}/>}</div>}
  </section>
}
