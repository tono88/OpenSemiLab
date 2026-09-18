import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ProjectFile, StoredProject } from './projectStore'
import type { Artifact, RunResult, RunSnapshot, SimulationData } from './eda-results'
import SpiceViewer from './SpiceViewer'
import WaveformViewer from './WaveformViewer'
import PhysicalDashboard from './PhysicalDashboard'
import RunHistory from './RunHistory'
import ToolCoverage, { type ToolIntegration } from './ToolCoverage'

type ArtifactKind='layout'|'netlist'|'timing'|'waveform'|'report'|'configuration'|'other'

function artifactKind(name:string):ArtifactKind {
  const lower=name.toLowerCase()
  if(['.gds','.def','.lef'].some(extension=>lower.endsWith(extension))) return 'layout'
  if(['.sdf','.sdc','.spef'].some(extension=>lower.endsWith(extension))) return 'timing'
  if(lower.endsWith('.vcd')) return 'waveform'
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
  const kinds:ArtifactKind[]=['layout','netlist','timing','waveform','report','configuration','other']
  const labels:Record<ArtifactKind,string>=es
    ? {layout:'Layout',netlist:'Netlists',timing:'Temporización',waveform:'Ondas',report:'Reportes',configuration:'Configuración',other:'Otros'}
    : {layout:'Layout',netlist:'Netlists',timing:'Timing',waveform:'Waveforms',report:'Reports',configuration:'Configuration',other:'Other'}
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

function compactSimulation(data:SimulationData|undefined):SimulationData|undefined {
  if(!data) return undefined
  return {...data,plots:data.plots.map(plot=>({...plot,series:plot.series.map(series=>{
    const stride=Math.max(1,Math.ceil(series.x.length/1000))
    return {...series,x:series.x.filter((_,index)=>index%stride===0),y:series.y.filter((_,index)=>index%stride===0)}
  })}))}
}

const HDL_EXTENSIONS=['.sv','.v']
const VHDL_EXTENSIONS=['.vhd','.vhdl']
const SPICE_EXTENSIONS=['.spice','.cir','.ckt','.lib']
const ADAPTER_EXTENSIONS:Record<string,string[]>={
  formal:[...HDL_EXTENSIONS,'.vh','.svh','.sby'],fpga:[...HDL_EXTENSIONS,'.vh','.svh','.pcf'],xyce:SPICE_EXTENSIONS,
  openems:['.xml'],xschem:['.sch','.sym','.tcl',...SPICE_EXTENSIONS],cace:['.yaml','.yml','.json',...SPICE_EXTENSIONS,'.sch','.sym','.tcl','.py'],
}
type Action='lint'|'simulate'|'synthesize'|'spice'|'vhdl'|'formal'|'fpga'|'xyce'|'openems'|'xschem'|'cace'|'gds3d'
interface ToolState { available:boolean }

const ADAPTERS=[
  {action:'formal' as Action,tool:'sby',title:'Verificación formal',titleEn:'Formal verification',detail:'SymbiYosys · propiedades y pruebas'},
  {action:'fpga' as Action,tool:'nextpnr_ice40',title:'Implementar FPGA',titleEn:'Implement FPGA',detail:'Yosys + nextpnr · iCE40 ASC'},
  {action:'xyce' as Action,tool:'xyce',title:'Simular con Xyce',titleEn:'Simulate with Xyce',detail:'SPICE paralelo · logs y tablas'},
  {action:'openems' as Action,tool:'openems',title:'Resolver RF / EM',titleEn:'Solve RF / EM',detail:'openEMS · XML, campos y Touchstone'},
  {action:'xschem' as Action,tool:'xschem',title:'Generar netlist',titleEn:'Generate netlist',detail:'Xschem headless · SPICE'},
  {action:'cace' as Action,tool:'cace',title:'Caracterizar circuito',titleEn:'Characterize circuit',detail:'CACE · esquinas y métricas'},
]

function WizardStep({id,number,title,summary,open,onToggle,children,status}:{id:string;number:string;title:string;summary:string;open:boolean;onToggle:()=>void;children:ReactNode;status?:string}) {
  return <section className={`wizard-step ${open?'open':''}`} id={`wizard-${id}`}><button className="wizard-step-header" onClick={onToggle} aria-expanded={open}><span>{number}</span><div><b>{title}</b><small>{summary}</small></div>{status&&<em>{status}</em>}<i>{open?'−':'+'}</i></button>{open&&<div className="wizard-step-body">{children}</div>}</section>
}

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
  const [physicalResult,setPhysicalResult]=useState<RunResult|null>(null)
  const [error,setError]=useState('')
  const [tools,setTools]=useState<Record<string,ToolState>>({})
  const [integrations,setIntegrations]=useState<ToolIntegration[]>([])
  const [openSteps,setOpenSteps]=useState(()=>new Set(['files','run']))
  const [worker,setWorker]=useState<'checking'|'online'|'degraded'|'offline'>('checking')
  const [clockPort,setClockPort]=useState(String(initialPhysical.clock_port??'clk'))
  const [clockPeriod,setClockPeriod]=useState(Number(initialPhysical.clock_period_ns??10))
  const [dieWidth,setDieWidth]=useState(Number(initialPhysical.die_width_um??120))
  const [dieHeight,setDieHeight]=useState(Number(initialPhysical.die_height_um??120))
  const [utilization,setUtilization]=useState(Number(initialPhysical.core_utilization_pct??40))
  const [formalDepth,setFormalDepth]=useState(Number(initialManifest.adapters?.formal?.depth??20))
  const [fpgaDevice,setFpgaDevice]=useState(String(initialManifest.adapters?.fpga?.device??'up5k'))
  const [fpgaPackage,setFpgaPackage]=useState(String(initialManifest.adapters?.fpga?.package??'sg48'))
  const [fpgaFrequency,setFpgaFrequency]=useState(Number(initialManifest.adapters?.fpga?.frequency_mhz??12))
  const [physicalStatus,setPhysicalStatus]=useState('')
  const historyKey=`opensemilab.runs.${project.id}`
  const [runHistory,setRunHistory]=useState<RunSnapshot[]>(()=>{
    try {return JSON.parse(localStorage.getItem(historyKey)??'[]')}
    catch {return []}
  })
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
  const vhdlSources=project.files.filter(file=>VHDL_EXTENSIONS.some(ext=>file.path.toLowerCase().endsWith(ext)))
  const rtlSources=hdlSources.filter(file=>file.role==='source')
  const testbenches=hdlSources.filter(file=>file.role==='testbench')
  const spiceSources=project.files.filter(file=>SPICE_EXTENSIONS.some(ext=>file.path.toLowerCase().endsWith(ext)))
  const spiceEntry=spiceSources.find(file=>file.path===execution.spiceEntry)??spiceSources.find(file=>file.role==='testbench')??spiceSources[0]
  const adapterFiles=useMemo(()=>Object.fromEntries(Object.entries(ADAPTER_EXTENSIONS).map(([action,extensions])=>[action,project.files.filter(file=>{
    if(file.path==='project.json'||!extensions.some(ext=>file.path.toLowerCase().endsWith(ext)))return false
    if(action==='formal')return file.role==='source'||file.path.toLowerCase().endsWith('.sby')
    if(action==='fpga')return file.role==='source'||file.path.toLowerCase().endsWith('.pcf')
    return true
  })])),[project.files]) as Record<string,ProjectFile[]>
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
      const body=await response.json();setTools(body.tools??{});setIntegrations(body.integrations??[]);setWorker(body.ready?'online':'degraded')
    } catch {setWorker('offline')}
  }
  useEffect(()=>{void refreshCapabilities()},[])
  useEffect(()=>{
    try {setRunHistory(JSON.parse(localStorage.getItem(historyKey)??'[]'))}
    catch {setRunHistory([])}
  },[historyKey])

  function acceptResult(data:RunResult,action:string) {
    setResult(data)
    if(data.summary)setPhysicalResult(data)
    const snapshot:RunSnapshot={id:data.job_id,createdAt:new Date().toISOString(),action:data.action??action,engine:data.engine,success:data.success,duration_ms:data.duration_ms,simulation:compactSimulation(data.simulation),summary:data.summary}
    setRunHistory(previous=>{
      const next=[snapshot,...previous.filter(item=>item.id!==snapshot.id)].slice(0,8)
      try {localStorage.setItem(historyKey,JSON.stringify(next))} catch { /* History is optional. */ }
      return next
    })
  }

  function clearHistory() {try {localStorage.removeItem(historyKey)} catch { /* Ignore unavailable storage. */ }setRunHistory([])}

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
    const relevant=action==='spice'?spiceSources:action==='vhdl'?vhdlSources:(action==='simulate'?[...rtlSources,...testbenches]:rtlSources)
    const sources=Object.fromEntries(relevant.map(file=>[file.path,file.content]))
    try {
      if(action==='simulate'&&!testbenches.length) throw new Error(es?'Agregue un archivo con rol testbench antes de simular.':'Add a file with the testbench role before simulation.')
      if(action==='spice'&&!spiceEntry) throw new Error(es?'Este proyecto no contiene un netlist SPICE ejecutable.':'This project does not contain an executable SPICE netlist.')
      const top=action==='simulate'||action==='vhdl'?execution.testbenchTop:execution.rtlTop
      const response=await fetch('/api/v1/eda/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,top:top??'top',entry:action==='spice'?spiceEntry?.path:undefined,sources})})
      const data=await response.json();if(!response.ok) throw new Error(data.detail??'EDA execution failed');acceptResult(data,action)
    } catch(reason) {setError(reason instanceof Error?reason.message:'EDA execution failed')}
    finally {setRunning('')}
  }

  async function runAdapter(action:Action) {
    const retainedGds=physicalResult?.artifacts.find(artifact=>['.gds','.gdsii'].some(extension=>artifact.name.toLowerCase().endsWith(extension)))
    setRunning(action);setError('');setResult(null)
    try {
      let files=adapterFiles[action]??[]
      let sources=Object.fromEntries(files.map(file=>[file.path,file.content]))
      let entry:string|undefined
      let adapter:Record<string,string|number>|undefined
      let encodings:Record<string,'base64'>|undefined
      if(action==='formal') {entry=files.find(file=>file.path.endsWith('.sby'))?.path;adapter={depth:formalDepth}}
      if(action==='fpga') adapter={device:fpgaDevice,package:fpgaPackage,frequency_mhz:fpgaFrequency}
      if(action==='xyce') entry=spiceEntry?.path
      if(action==='openems') entry=files.find(file=>file.path.toLowerCase().endsWith('.xml'))?.path
      if(action==='xschem') entry=files.find(file=>file.path.toLowerCase().endsWith('.sch'))?.path
      if(action==='cace') entry=files.find(file=>/cace|datasheet/i.test(file.path)&&/\.ya?ml$|\.json$/i.test(file.path))?.path??files.find(file=>/\.ya?ml$/i.test(file.path))?.path
      if(action==='gds3d') {
        if(!retainedGds)throw new Error(es?'Ejecute RTL → GDSII antes de validar con GDS3D.':'Run RTL → GDSII before validating with GDS3D.')
        const name=`layout/${retainedGds.name.split('/').pop()??'design.gds'}`
        sources={[name]:retainedGds.content};entry=name;encodings=retainedGds.encoding==='base64'?{[name]:'base64'}:undefined
      }
      if(!Object.keys(sources).length)throw new Error(es?'Agregue los archivos de entrada requeridos para este adaptador.':'Add the input files required by this adapter.')
      const response=await fetch('/api/v1/eda/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,top:execution.rtlTop??'top',entry,sources,encodings,adapter})})
      const data=await response.json();if(!response.ok)throw new Error(data.detail??'EDA adapter failed');acceptResult(data,action)
      const currentManifest=readManifest(project)
      if(adapter&&project.files.some(file=>file.path==='project.json'))onChange({...project,updatedAt:new Date().toISOString(),files:project.files.map(file=>file.path==='project.json'?{...file,content:JSON.stringify({...currentManifest,adapters:{...(currentManifest.adapters??{}),[action]:adapter}},null,2)+'\n'}:file)})
    } catch(reason) {setError(reason instanceof Error?reason.message:'EDA adapter failed')}
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
        if(job.status==='completed') {acceptResult(job.result,'physical');return}
        if(job.status==='failed') {if(job.result)acceptResult(job.result,'physical');else throw new Error(job.error??'Physical implementation failed');return}
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

  const waveform=result?.artifacts.find(artifact=>artifact.name.toLowerCase().endsWith('.vcd')&&artifact.encoding!=='base64')
  const physicalGds=physicalResult?.artifacts.find(artifact=>['.gds','.gdsii'].some(extension=>artifact.name.toLowerCase().endsWith(extension)))
  const dashboardResult=result?.summary?result:physicalResult
  const adapterReady=(action:Action)=>action==='formal'?adapterFiles.formal.some(file=>HDL_EXTENSIONS.some(ext=>file.path.endsWith(ext))):action==='fpga'?adapterFiles.fpga.some(file=>HDL_EXTENSIONS.some(ext=>file.path.endsWith(ext))):action==='xyce'?!!spiceEntry:action==='openems'?adapterFiles.openems.length>0:action==='xschem'?adapterFiles.xschem.some(file=>file.path.endsWith('.sch')):action==='cace'?adapterFiles.cace.some(file=>/cace|datasheet/i.test(file.path)&&/\.ya?ml$|\.json$/i.test(file.path)):action==='gds3d'?!!physicalGds:false
  const toggleStep=(id:string)=>setOpenSteps(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})
  const goStep=(id:string)=>{setOpenSteps(current=>new Set(current).add(id));window.setTimeout(()=>document.getElementById(`wizard-${id}`)?.scrollIntoView({behavior:'smooth',block:'start'}),0)}
  useEffect(()=>{if(result||error)setOpenSteps(current=>new Set(current).add('results'))},[result,error])

  return <section className="project-workspace">
    <div className="project-toolbar"><div><span>{es?'PROYECTO ACTIVO':'ACTIVE PROJECT'}</span><h2>{project.name}</h2><small>{project.kind} · {project.pdk} · {es?'guardado automático en este navegador':'autosaved in this browser'}</small></div><div><button onClick={exportProject}>{es?'Exportar':'Export'}</button><button onClick={onClose}>{es?'Cerrar':'Close'}</button></div></div>
    <div className={`workspace-worker ${worker}`}><i/>{worker==='online'?(es?'IIC-OSIC listo para ejecutar':'IIC-OSIC ready to run'):worker==='degraded'?(es?'Worker conectado; algunas herramientas no están disponibles':'Worker connected; some tools are unavailable'):worker==='checking'?(es?'Comprobando herramientas…':'Checking tools…'):(es?'Worker desconectado':'Worker offline')}<button onClick={refreshCapabilities}>{es?'Comprobar':'Check'}</button></div>
    <nav className="wizard-nav" aria-label={es?'Etapas del proyecto':'Project stages'}>{[['files','01',es?'Diseño':'Design'],['run','02',es?'Verificar':'Verify'],['physical','03','GDSII'],['results','04',es?'Resultados':'Results'],['history','05',es?'Historial':'History']].map(([id,number,label])=><button onClick={()=>goStep(id)} key={id}><span>{number}</span>{label}</button>)}</nav>
    <WizardStep id="files" number="01" title={es?'Diseño y archivos':'Design and files'} summary={es?'Edite fuentes, bancos de prueba y configuración':'Edit sources, testbenches, and configuration'} open={openSteps.has('files')} onToggle={()=>toggleStep('files')} status={`${project.files.length} ${es?'archivos':'files'}`}><div className="project-grid">
      <aside className="file-tree"><div><b>{es?'ARCHIVOS':'FILES'}</b><button onClick={addFile}>＋</button></div>{Object.entries(groups).map(([group,files])=><section key={group}><span>{group}</span>{files.map(file=><button className={file.path===selected?.path?'active':''} onClick={()=>setSelectedPath(file.path)} key={file.path}>{file.path.split('/').pop()}</button>)}</section>)}</aside>
      <div className="file-editor"><div><span>{selected?.path}</span><i>{selected?.role}</i><button onClick={removeFile}>{es?'Eliminar':'Delete'}</button></div><textarea value={selected?.content??''} onChange={event=>updateFile(event.target.value)} spellCheck={false}/></div>
    </div></WizardStep>
    <WizardStep id="run" number="02" title={es?'Verificación y simulación':'Verification and simulation'} summary={es?'Ejecute solo la herramienta que necesita':'Run only the tool you need'} open={openSteps.has('run')} onToggle={()=>toggleStep('run')} status={worker==='online'?(es?'Listo':'Ready'):worker}>
      <ToolCoverage integrations={integrations} locale={locale}/>
      {(rtlSources.length||spiceSources.length||vhdlSources.length)?<div className="execution-panel"><div><b>{es?'FLUJO PRINCIPAL':'PRIMARY FLOW'}</b><small>{execution.rtlTop?`RTL top: ${execution.rtlTop}`:''}{execution.spiceEntry?` · SPICE: ${execution.spiceEntry}`:''}</small></div><div className="project-actions">{rtlSources.length>0&&<button disabled={!!running||worker==='offline'||!(tools.verible_lint?.available||tools.verilator?.available)} onClick={()=>run('lint')}>{running==='lint'?(es?'Ejecutando…':'Running…'):(es?'Analizar RTL':'Lint RTL')}<small>{tools.verible_lint?.available?'Verible':'Verilator'}</small></button>}{testbenches.length>0&&<button disabled={!!running||worker==='offline'||!(tools.iverilog?.available&&tools.vvp?.available)} onClick={()=>run('simulate')}>{running==='simulate'?(es?'Ejecutando…':'Running…'):(es?'Simular RTL':'Simulate RTL')}<small>Icarus Verilog</small></button>}{vhdlSources.length>0&&<button disabled={!!running||worker==='offline'||!tools.ghdl?.available} onClick={()=>run('vhdl')}>{running==='vhdl'?(es?'Ejecutando…':'Running…'):(es?'Simular VHDL':'Simulate VHDL')}<small>GHDL 2008</small></button>}{rtlSources.length>0&&<button disabled={!!running||worker==='offline'||!tools.yosys?.available} onClick={()=>run('synthesize')}>{running==='synthesize'?(es?'Ejecutando…':'Running…'):(es?'Sintetizar':'Synthesize')}<small>Yosys</small></button>}{spiceEntry&&<button disabled={!!running||worker==='offline'||!tools.ngspice?.available} onClick={()=>run('spice')}>{running==='spice'?(es?'Ejecutando…':'Running…'):(es?'Simular SPICE':'Simulate SPICE')}<small>ngspice</small></button>}</div></div>:<div className="adapter-message">{es?'Este proyecto aún no contiene archivos ejecutables.':'This project does not contain executable files yet.'}</div>}
      <section className="adapter-hub"><div className="adapter-hub-heading"><div><span>{es?'ADAPTADORES ESPECIALIZADOS':'SPECIALIZED ADAPTERS'}</span><b>{es?'Flujos IIC-OSIC conectados':'Connected IIC-OSIC workflows'}</b></div><small>{es?'Los deshabilitados indican el archivo de entrada que falta.':'Disabled actions indicate a missing input file.'}</small></div><div className="adapter-grid">{ADAPTERS.map(item=>{const ready=adapterReady(item.action),available=tools[item.tool]?.available;return <article className={ready&&available?'ready':''} key={item.action}><div><i/><span><b>{es?item.title:item.titleEn}</b><small>{item.detail}</small></span></div>{item.action==='formal'&&<label>{es?'Profundidad':'Depth'}<input type="number" min="1" max="1000" value={formalDepth} onChange={event=>setFormalDepth(Number(event.target.value))}/></label>}{item.action==='fpga'&&<div className="adapter-inline"><select value={fpgaDevice} onChange={event=>setFpgaDevice(event.target.value)}><option value="up5k">UP5K</option><option value="hx8k">HX8K</option><option value="lp8k">LP8K</option><option value="hx1k">HX1K</option></select><input aria-label={es?'Paquete FPGA':'FPGA package'} value={fpgaPackage} onChange={event=>setFpgaPackage(event.target.value)}/><input aria-label="MHz" type="number" min="0.1" max="500" value={fpgaFrequency} onChange={event=>setFpgaFrequency(Number(event.target.value))}/></div>}<button disabled={!!running||worker==='offline'||!available||!ready} onClick={()=>runAdapter(item.action)}>{running===item.action?(es?'Ejecutando…':'Running…'):(es?'Ejecutar':'Run')}<small>{!available?(es?'No instalada':'Not installed'):!ready?(es?'Falta entrada compatible':'Compatible input required'):item.tool}</small></button></article>})}</div></section>
    </WizardStep>
    <WizardStep id="physical" number="03" title={es?'Implementación física':'Physical implementation'} summary="RTL → GDSII · LibreLane / OpenROAD" open={openSteps.has('physical')} onToggle={()=>toggleStep('physical')} status={physicalResult?(physicalResult.success?'PASS':'FAIL'):undefined}>{rtlSources.length>0&&['sky130A','gf180mcuD'].includes(project.pdk)?<div className="physical-panel"><div className="physical-heading"><span>GDS</span><div><b>{es?'IMPLEMENTACIÓN FÍSICA RTL → GDSII':'PHYSICAL IMPLEMENTATION RTL → GDSII'}</b><small>{es?'LibreLane coordina Yosys, OpenROAD, OpenSTA, Magic, Netgen y KLayout.':'LibreLane orchestrates Yosys, OpenROAD, OpenSTA, Magic, Netgen, and KLayout.'}</small></div></div><div className="physical-steps">{['Synthesis','Floorplan','Placement','CTS','Routing','Sign-off'].map((stage,index)=><i className={running==='physical'?'active':physicalResult?.success?'done':''} key={stage}><span>{String(index+1).padStart(2,'0')}</span>{stage}</i>)}</div><div className="physical-config"><label>{es?'Puerto de reloj':'Clock port'}<input value={clockPort} onChange={event=>setClockPort(event.target.value)}/></label><label>{es?'Período (ns)':'Period (ns)'}<input type="number" min="0.1" max="1000" step="0.1" value={clockPeriod} onChange={event=>setClockPeriod(Number(event.target.value))}/></label><label>{es?'Ancho (µm)':'Width (µm)'}<input type="number" min="30" max="5000" value={dieWidth} onChange={event=>setDieWidth(Number(event.target.value))}/></label><label>{es?'Alto (µm)':'Height (µm)'}<input type="number" min="30" max="5000" value={dieHeight} onChange={event=>setDieHeight(Number(event.target.value))}/></label><label>{es?'Utilización (%)':'Utilization (%)'}<input type="number" min="5" max="80" value={utilization} onChange={event=>setUtilization(Number(event.target.value))}/></label><button disabled={!!running||worker==='offline'||!tools.librelane?.available} onClick={runPhysical}>{running==='physical'?(es?'Implementando…':'Implementing…'):(es?'Ejecutar RTL → GDSII':'Run RTL → GDSII')}<small>LibreLane Classic</small></button></div>{physicalStatus&&<p className="physical-status">{physicalStatus}</p>}{physicalGds&&<div className="gds3d-action"><div><b>{es?'GDSII listo':'GDSII ready'}</b><small>{physicalGds.name}</small></div><button disabled={!!running||!tools.gds3d?.available} onClick={()=>runAdapter('gds3d')}>{running==='gds3d'?(es?'Validando…':'Validating…'):(es?'Validar en GDS3D':'Validate in GDS3D')}<small>{es?'El visor interactivo está en Resultados':'Interactive viewer is in Results'}</small></button></div>}</div>:<div className="adapter-message">{es?'Disponible para proyectos RTL con SKY130 o GF180.':'Available for RTL projects using SKY130 or GF180.'}</div>}</WizardStep>
    <WizardStep id="results" number="04" title={es?'Resultados y análisis':'Results and analysis'} summary={es?'Gráficas, ondas, layout, consola y artefactos':'Plots, waveforms, layout, console, and artifacts'} open={openSteps.has('results')} onToggle={()=>toggleStep('results')} status={result?.success?'PASS':result?'FAIL':undefined}>{error&&<p className="error">{error}</p>}{result?.simulation&&result.simulation.plots.length>0&&<SpiceViewer data={result.simulation} locale={locale}/>} {waveform&&<WaveformViewer content={waveform.content} locale={locale}/>} {dashboardResult?.summary&&<PhysicalDashboard summary={dashboardResult.summary} artifacts={dashboardResult.artifacts} locale={locale}/>} {result?<div className="console"><div className="console-header"><span>{result.engine} · {result.duration_ms} ms{result.pdk?` · ${result.pdk}`:''}</span><b className={result.success?'success':'failed'}>{result.success?(es?'CORRECTO':'PASSED'):(es?'FALLÓ':'FAILED')} · EXIT {result.exit_code}</b></div><details className="console-output" open={!result.success}><summary>{es?'Registro de ejecución':'Execution log'}</summary><pre>{result.output||(es?'La herramienta terminó sin salida.':'The tool completed without output.')}</pre></details>{result.artifacts.length>0&&<ArtifactBrowser artifacts={result.artifacts} locale={locale} onDownload={downloadArtifact}/>}</div>:!error&&!dashboardResult&&<div className="empty-results">{es?'Ejecute una etapa para ver aquí todos sus resultados.':'Run a stage to see all of its results here.'}</div>}</WizardStep>
    <WizardStep id="history" number="05" title={es?'Comparación e historial':'Comparison and history'} summary={es?'Compare las últimas ejecuciones sin salir del proyecto':'Compare recent runs without leaving the project'} open={openSteps.has('history')} onToggle={()=>toggleStep('history')} status={`${runHistory.length}`}><RunHistory runs={runHistory} locale={locale} onClear={clearHistory}/></WizardStep>
  </section>
}
