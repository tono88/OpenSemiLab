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
type StageId='files'|'verification'|'simulation'|'physical'|'results'
interface ToolState { available:boolean }

const ACTION_STAGE:Record<Action|'physical',StageId>={
  lint:'verification',synthesize:'verification',formal:'verification',fpga:'verification',
  simulate:'simulation',spice:'simulation',vhdl:'simulation',xyce:'simulation',openems:'simulation',xschem:'simulation',cace:'simulation',
  physical:'physical',gds3d:'physical',
}

const ADAPTERS=[
  {stage:'verification',action:'formal' as Action,tool:'sby',title:'Verificación formal',titleEn:'Formal verification',detail:'SymbiYosys · propiedades y pruebas'},
  {stage:'verification',action:'fpga' as Action,tool:'nextpnr_ice40',title:'Implementar FPGA',titleEn:'Implement FPGA',detail:'Yosys + nextpnr · iCE40 ASC'},
  {stage:'simulation',action:'xyce' as Action,tool:'xyce',title:'Simular con Xyce',titleEn:'Simulate with Xyce',detail:'SPICE paralelo · logs y tablas'},
  {stage:'simulation',action:'openems' as Action,tool:'openems',title:'Resolver RF / EM',titleEn:'Solve RF / EM',detail:'openEMS · XML, campos y Touchstone'},
  {stage:'simulation',action:'xschem' as Action,tool:'xschem',title:'Generar netlist',titleEn:'Generate netlist',detail:'Xschem headless · SPICE'},
  {stage:'simulation',action:'cace' as Action,tool:'cace',title:'Caracterizar circuito',titleEn:'Characterize circuit',detail:'CACE · esquinas y métricas'},
]

function WizardStep({id,number,title,summary,open,onToggle,children,status}:{id:string;number:string;title:string;summary:string;open:boolean;onToggle:()=>void;children:ReactNode;status?:string}) {
  return <section className={`wizard-step ${open?'open':''}`} id={`wizard-${id}`}><button className="wizard-step-header" onClick={onToggle} aria-expanded={open}><span>{number}</span><div><b>{title}</b><small>{summary}</small></div>{status&&<em>{status}</em>}<i>{open?'−':'+'}</i></button>{open&&<div className="wizard-step-body">{children}</div>}</section>
}

const EXECUTION_DEFAULTS:Record<string,{rtlTop?:string;fpgaTop?:string;testbenchTop?:string;spiceEntry?:string}>={
  microcontroller:{rtlTop:'top',testbenchTop:'tb_top'},
  fpga_prototype:{rtlTop:'top',testbenchTop:'tb_top'},
  sensor_interface:{rtlTop:'sensor_ctrl',testbenchTop:'tb_sensor_ctrl',spiceEntry:'simulation/afe_transient.cir'},
  analog_block:{spiceEntry:'simulation/testbench.spice'},
  rf_frontend:{spiceEntry:'schematic/lna.spice'},
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
  const [errorStage,setErrorStage]=useState<StageId|null>(null)
  const [tools,setTools]=useState<Record<string,ToolState>>({})
  const [integrations,setIntegrations]=useState<ToolIntegration[]>([])
  const [openSteps,setOpenSteps]=useState<Set<string>>(()=>new Set())
  const [historyOpen,setHistoryOpen]=useState(false)
  const [activeStage,setActiveStage]=useState<StageId>('files')
  const [stageResults,setStageResults]=useState<Partial<Record<StageId,RunResult>>>({})
  const [consoleOpen,setConsoleOpen]=useState(true)
  const [copiedConsole,setCopiedConsole]=useState('')
  const [worker,setWorker]=useState<'checking'|'online'|'degraded'|'offline'>('checking')
  const [clockPort,setClockPort]=useState(String(initialPhysical.clock_port??'clk'))
  const [clockPeriod,setClockPeriod]=useState(Number(initialPhysical.clock_period_ns??10))
  const [dieWidth,setDieWidth]=useState(Number(initialPhysical.die_width_um??120))
  const [dieHeight,setDieHeight]=useState(Number(initialPhysical.die_height_um??120))
  const [utilization,setUtilization]=useState(Number(initialPhysical.core_utilization_pct??40))
  const [formalDepth,setFormalDepth]=useState(Number(initialManifest.adapters?.formal?.depth??20))
  const [formalMode,setFormalMode]=useState<'bmc'|'prove'>(initialManifest.adapters?.formal?.mode==='prove'?'prove':'bmc')
  const [fpgaTop,setFpgaTop]=useState(String(initialManifest.execution?.fpga_top??initialManifest.execution?.rtl_top??'top'))
  const [fpgaDevice,setFpgaDevice]=useState(String(initialManifest.adapters?.fpga?.device??'up5k'))
  const [fpgaPackage,setFpgaPackage]=useState(String(initialManifest.adapters?.fpga?.package??'sg48'))
  const [fpgaFrequency,setFpgaFrequency]=useState(Number(initialManifest.adapters?.fpga?.frequency_mhz??12))
  const [physicalStatus,setPhysicalStatus]=useState('')
  const [physicalElapsed,setPhysicalElapsed]=useState(0)
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
      return {rtlTop:parsed.rtl_top??fallback.rtlTop,fpgaTop:parsed.fpga_top??parsed.rtl_top??fallback.fpgaTop??fallback.rtlTop,testbenchTop:parsed.testbench_top??fallback.testbenchTop,spiceEntry:parsed.spice_entry??fallback.spiceEntry}
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
    if(running!=='physical')return
    const started=Date.now()-physicalElapsed*1000
    const timer=window.setInterval(()=>setPhysicalElapsed(Math.floor((Date.now()-started)/1000)),1000)
    return ()=>window.clearInterval(timer)
  },[running])
  useEffect(()=>{
    try {setRunHistory(JSON.parse(localStorage.getItem(historyKey)??'[]'))}
    catch {setRunHistory([])}
  },[historyKey])

  function acceptResult(data:RunResult,action:string) {
    setResult(data)
    if(data.summary)setPhysicalResult(data)
    const stage=ACTION_STAGE[action as Action|'physical']??'results'
    setStageResults(previous=>({...previous,[stage]:data}))
    setActiveStage(stage)
    setConsoleOpen(true)
    const snapshot:RunSnapshot={id:data.job_id,createdAt:new Date().toISOString(),action:data.action??action,engine:data.engine,success:data.success,duration_ms:data.duration_ms,simulation:compactSimulation(data.simulation),summary:data.summary,formal_status:data.formal_status}
    setRunHistory(previous=>{
      const next=[snapshot,...previous.filter(item=>item.id!==snapshot.id)].slice(0,8)
      try {localStorage.setItem(historyKey,JSON.stringify(next))} catch { /* History is optional. */ }
      return next
    })
  }

  function clearHistory() {
    const confirmed=window.confirm(es?'¿Eliminar todo el historial de ejecuciones de este proyecto? Esta acción no se puede deshacer.':'Delete the complete run history for this project? This action cannot be undone.')
    if(!confirmed)return
    try {localStorage.removeItem(historyKey)} catch { /* Ignore unavailable storage. */ }
    setRunHistory([])
  }

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
    setActiveStage(ACTION_STAGE[action]);setErrorStage(ACTION_STAGE[action]);setConsoleOpen(true)
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
    setActiveStage(ACTION_STAGE[action]);setErrorStage(ACTION_STAGE[action]);setConsoleOpen(true);setRunning(action);setError('');setResult(null)
    try {
      let files=adapterFiles[action]??[]
      let sources=Object.fromEntries(files.map(file=>[file.path,file.content]))
      let entry:string|undefined
      let adapter:Record<string,string|number>|undefined
      let encodings:Record<string,'base64'>|undefined
      if(action==='formal') {entry=files.find(file=>file.path.endsWith('.sby'))?.path;adapter={depth:formalDepth,mode:formalMode}}
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
      const actionTop=action==='fpga'?fpgaTop:(execution.rtlTop??'top')
      const response=await fetch('/api/v1/eda/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,top:actionTop,entry,sources,encodings,adapter})})
      const data=await response.json();if(!response.ok)throw new Error(data.detail??'EDA adapter failed');acceptResult(data,action)
      const currentManifest=readManifest(project)
      if(adapter&&project.files.some(file=>file.path==='project.json'))onChange({...project,updatedAt:new Date().toISOString(),files:project.files.map(file=>file.path==='project.json'?{...file,content:JSON.stringify({...currentManifest,execution:action==='fpga'?{...(currentManifest.execution??{}),fpga_top:fpgaTop}:currentManifest.execution,adapters:{...(currentManifest.adapters??{}),[action]:adapter}},null,2)+'\n'}:file)})
    } catch(reason) {setError(reason instanceof Error?reason.message:'EDA adapter failed')}
    finally {setRunning('')}
  }

  async function runPhysical() {
    setActiveStage('physical');setErrorStage('physical');setConsoleOpen(true);setPhysicalElapsed(0);setRunning('physical');setPhysicalStatus(es?'Preparando y enviando el trabajo…':'Preparing and submitting job…');setError('');setResult(null)
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

  function selectConsole(id:string) {
    const element=document.getElementById(id)
    if(!element)return
    const range=document.createRange();range.selectNodeContents(element)
    const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range)
  }

  async function copyConsole(id:string) {
    const content=document.getElementById(id)?.textContent??''
    if(!content)return
    try {await navigator.clipboard.writeText(content);setCopiedConsole(id);window.setTimeout(()=>setCopiedConsole(current=>current===id?'':current),1600)}
    catch {selectConsole(id)}
  }

  const waveform=result?.artifacts.find(artifact=>artifact.name.toLowerCase().endsWith('.vcd')&&artifact.encoding!=='base64')
  const physicalGds=physicalResult?.artifacts.find(artifact=>['.gds','.gdsii'].some(extension=>artifact.name.toLowerCase().endsWith(extension)))
  const dashboardResult=result?.summary?result:physicalResult
  const adapterReady=(action:Action)=>action==='formal'?adapterFiles.formal.some(file=>HDL_EXTENSIONS.some(ext=>file.path.endsWith(ext))):action==='fpga'?adapterFiles.fpga.some(file=>HDL_EXTENSIONS.some(ext=>file.path.endsWith(ext))):action==='xyce'?!!spiceEntry:action==='openems'?adapterFiles.openems.length>0:action==='xschem'?adapterFiles.xschem.some(file=>file.path.endsWith('.sch')):action==='cace'?adapterFiles.cace.some(file=>/cace|datasheet/i.test(file.path)&&/\.ya?ml$|\.json$/i.test(file.path)):action==='gds3d'?!!physicalGds:false
  const adapterUnavailableReason=(action:Action,available:boolean|undefined,ready:boolean)=>{
    if(worker==='offline')return es?'El servicio de ejecución está desconectado.':'The execution service is offline.'
    if(!available)return es?'La herramienta no está instalada o no fue detectada en el worker.':'The tool is not installed or was not detected in the worker.'
    if(ready)return ''
    const required:Partial<Record<Action,string>>={formal:'.sv o .v con rol source',fpga:'.sv/.v y opcionalmente .pcf',xyce:'.spice, .cir o .ckt',openems:'.xml de openEMS',xschem:'.sch de Xschem',cace:'cace.yaml o datasheet.yaml',gds3d:'un .gds generado por RTL → GDSII'}
    return `${es?'No disponible: este proyecto necesita':'Unavailable: this project needs'} ${required[action]??(es?'una entrada compatible':'a compatible input')}.`
  }
  const renderAdapterCards=(stage:'verification'|'simulation')=>ADAPTERS.filter(item=>item.stage===stage).map(item=>{
    const ready=adapterReady(item.action),available=tools[item.tool]?.available,reason=adapterUnavailableReason(item.action,available,ready)
    return <article className={ready&&available?'ready':''} key={item.action}>
      <div><i/><span><b>{es?item.title:item.titleEn}</b><small>{item.detail}</small></span></div>
      {item.action==='formal'&&<div className="adapter-inline formal-options">
        <label>{es?'Modo':'Mode'}<select value={formalMode} onChange={event=>setFormalMode(event.target.value as 'bmc'|'prove')}><option value="bmc">BMC · {es?'acotada':'bounded'}</option><option value="prove">PROVE · {es?'inducción':'induction'}</option></select></label>
        <label>{es?'Profundidad':'Depth'}<input type="number" min="1" max="1000" value={formalDepth} onChange={event=>setFormalDepth(Number(event.target.value))}/></label>
      </div>}
      {item.action==='fpga'&&<div className="adapter-inline fpga-options"><input aria-label={es?'Módulo superior FPGA':'FPGA top module'} title={es?'Módulo wrapper con los pines físicos de la tarjeta':'Board wrapper module with physical pins'} value={fpgaTop} onChange={event=>setFpgaTop(event.target.value)}/><select aria-label={es?'Dispositivo FPGA':'FPGA device'} value={fpgaDevice} onChange={event=>setFpgaDevice(event.target.value)}><option value="up5k">UP5K</option><option value="hx8k">HX8K</option><option value="lp8k">LP8K</option><option value="hx1k">HX1K</option></select><input aria-label={es?'Paquete FPGA':'FPGA package'} value={fpgaPackage} onChange={event=>setFpgaPackage(event.target.value)}/><input aria-label="MHz" type="number" min="0.1" max="500" value={fpgaFrequency} onChange={event=>setFpgaFrequency(Number(event.target.value))}/></div>}
      <div className="adapter-run" data-tooltip={reason} tabIndex={reason?0:undefined}><button disabled={!!running||worker==='offline'||!available||!ready} onClick={()=>runAdapter(item.action)}>{running===item.action?(es?'Ejecutando…':'Running…'):(es?'Ejecutar':'Run')}<small>{!available?(es?'No instalada':'Not installed'):!ready?(es?'Falta entrada compatible':'Compatible input required'):item.tool}</small></button></div>
    </article>
  })
  const toggleStep=(id:StageId)=>{setActiveStage(id);setOpenSteps(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})}
  const goStep=(id:StageId)=>{setActiveStage(id);setOpenSteps(current=>new Set(current).add(id));window.setTimeout(()=>document.getElementById(`wizard-${id}`)?.scrollIntoView({behavior:'smooth',block:'start'}),0)}
  const dockResult=activeStage==='results'?result:stageResults[activeStage]
  const stageLabel:Record<StageId,string>={files:es?'Diseño':'Design',verification:es?'Verificación':'Verification',simulation:es?'Simulación':'Simulation',physical:'GDSII',results:es?'Resultados':'Results'}

  return <section className="project-workspace">
    <div className="project-toolbar"><div><span>{es?'PROYECTO ACTIVO':'ACTIVE PROJECT'}</span><h2>{project.name}</h2><small>{project.kind} · {project.pdk} · {es?'guardado automático en este navegador':'autosaved in this browser'}</small></div><div><button onClick={exportProject}>{es?'Exportar':'Export'}</button><button onClick={onClose}>{es?'Cerrar':'Close'}</button></div></div>
    <div className={`workspace-worker ${worker}`}><i/>{worker==='online'?(es?'Flujo de diseño IIC-OSIC listo para ejecutar':'IIC-OSIC design flow ready to run'):worker==='degraded'?(es?'Flujo conectado; algunas herramientas no están disponibles':'Flow connected; some tools are unavailable'):worker==='checking'?(es?'Comprobando herramientas del flujo…':'Checking flow tools…'):(es?'Flujo de ejecución desconectado':'Execution flow offline')}<button onClick={refreshCapabilities}>{es?'Comprobar':'Check'}</button></div>
    <details className="tool-inventory"><summary>{es?'Ver cobertura de herramientas IIC-OSIC':'View IIC-OSIC tool coverage'}<span>{integrations.filter(item=>item.available).length}/{integrations.length}</span></summary><ToolCoverage integrations={integrations} locale={locale}/></details>
    <section className="flow-overview"><div><span>{es?'FLUJO DEL PROYECTO':'PROJECT FLOW'}</span><b>{es?'Del diseño a los resultados en cinco etapas':'From design to results in five stages'}</b><small>{es?'Abra únicamente la etapa en la que desea trabajar.':'Open only the stage you want to work on.'}</small></div><button className={historyOpen?'active':''} onClick={()=>setHistoryOpen(value=>!value)}>{es?'Historial':'History'} <i>{runHistory.length}</i></button></section>
    <nav className="wizard-nav" aria-label={es?'Etapas del proyecto':'Project stages'}>{[['files','01',es?'Diseño':'Design'],['verification','02',es?'Verificación':'Verification'],['simulation','03',es?'Simulación':'Simulation'],['physical','04','GDSII'],['results','05',es?'Resultados':'Results']].map(([id,number,label])=><button className={openSteps.has(id)?'active':''} onClick={()=>goStep(id as StageId)} key={id}><span>{number}</span><b>{label}</b><small>{openSteps.has(id)?(es?'Etapa abierta':'Stage open'):(es?'Abrir etapa':'Open stage')} →</small></button>)}</nav>
    {historyOpen&&<section className="workspace-history">{runHistory.length?<RunHistory runs={runHistory} locale={locale} onClear={clearHistory}/>:<p className="empty-history">{es?'Todavía no hay ejecuciones guardadas para este proyecto.':'There are no saved runs for this project yet.'}</p>}</section>}
    <div className="wizard-flow">
    <WizardStep id="files" number="01" title={es?'Diseño y archivos':'Design and files'} summary={es?'Edite fuentes, bancos de prueba y configuración':'Edit sources, testbenches, and configuration'} open={openSteps.has('files')} onToggle={()=>toggleStep('files')} status={`${project.files.length} ${es?'archivos':'files'}`}><div className="project-grid">
      <aside className="file-tree"><div><b>{es?'ARCHIVOS':'FILES'}</b><button onClick={addFile}>＋</button></div>{Object.entries(groups).map(([group,files])=><section key={group}><span>{group}</span>{files.map(file=><button className={file.path===selected?.path?'active':''} onClick={()=>setSelectedPath(file.path)} key={file.path}>{file.path.split('/').pop()}</button>)}</section>)}</aside>
      <div className="file-editor"><div><span>{selected?.path}</span><i>{selected?.role}</i><button onClick={removeFile}>{es?'Eliminar':'Delete'}</button></div><textarea value={selected?.content??''} onChange={event=>updateFile(event.target.value)} spellCheck={false}/></div>
    </div></WizardStep>
    <WizardStep id="verification" number="02" title={es?'Verificación':'Verification'} summary={es?'Analice, sintetice y demuestre propiedades antes de simular':'Lint, synthesize, and prove properties before simulation'} open={openSteps.has('verification')} onToggle={()=>toggleStep('verification')} status={worker==='online'?(es?'Listo':'Ready'):worker}>
      {rtlSources.length?<div className="execution-panel"><div><b>{es?'COMPROBACIONES PRINCIPALES':'PRIMARY CHECKS'}</b><small>{execution.rtlTop?`RTL top: ${execution.rtlTop}`:''}</small></div><div className="project-actions">{rtlSources.length>0&&<button disabled={!!running||worker==='offline'||!(tools.verible_lint?.available||tools.verilator?.available)} onClick={()=>run('lint')}>{running==='lint'?(es?'Ejecutando…':'Running…'):(es?'Analizar RTL':'Lint RTL')}<small>{tools.verible_lint?.available?'Verible':'Verilator'}</small></button>}{rtlSources.length>0&&<button disabled={!!running||worker==='offline'||!tools.yosys?.available} onClick={()=>run('synthesize')}>{running==='synthesize'?(es?'Ejecutando…':'Running…'):(es?'Sintetizar':'Synthesize')}<small>Yosys</small></button>}</div></div>:<div className="adapter-message">{es?'Agregue fuentes RTL para habilitar las verificaciones.':'Add RTL sources to enable verification.'}</div>}
      <section className="adapter-hub"><div className="adapter-hub-heading"><div><span>{es?'VERIFICACIÓN ESPECIALIZADA':'SPECIALIZED VERIFICATION'}</span><b>SymbiYosys · Yosys · nextpnr</b></div><small>{es?'Los controles se habilitan al detectar entradas compatibles.':'Controls become available when compatible inputs are detected.'}</small></div><div className="adapter-grid">{renderAdapterCards('verification')}</div></section>
    </WizardStep>
    <WizardStep id="simulation" number="03" title={es?'Simulación':'Simulation'} summary={es?'Ejecute simulaciones digitales, analógicas y electromagnéticas':'Run digital, analog, and electromagnetic simulations'} open={openSteps.has('simulation')} onToggle={()=>toggleStep('simulation')} status={worker==='online'?(es?'Listo':'Ready'):worker}>
      {(testbenches.length||vhdlSources.length||spiceEntry)?<div className="execution-panel"><div><b>{es?'MOTORES DE SIMULACIÓN':'SIMULATION ENGINES'}</b><small>{execution.spiceEntry?`SPICE: ${execution.spiceEntry}`:''}</small></div><div className="project-actions">{testbenches.length>0&&<button disabled={!!running||worker==='offline'||!(tools.iverilog?.available&&tools.vvp?.available)} onClick={()=>run('simulate')}>{running==='simulate'?(es?'Ejecutando…':'Running…'):(es?'Simular RTL':'Simulate RTL')}<small>Icarus Verilog</small></button>}{vhdlSources.length>0&&<button disabled={!!running||worker==='offline'||!tools.ghdl?.available} onClick={()=>run('vhdl')}>{running==='vhdl'?(es?'Ejecutando…':'Running…'):(es?'Simular VHDL':'Simulate VHDL')}<small>GHDL 2008</small></button>}{spiceEntry&&<button disabled={!!running||worker==='offline'||!tools.ngspice?.available} onClick={()=>run('spice')}>{running==='spice'?(es?'Ejecutando…':'Running…'):(es?'Simular SPICE':'Simulate SPICE')}<small>ngspice</small></button>}</div></div>:<div className="adapter-message">{es?'Agregue un testbench o netlist SPICE para habilitar la simulación.':'Add a testbench or SPICE netlist to enable simulation.'}</div>}
      <section className="adapter-hub"><div className="adapter-hub-heading"><div><span>{es?'SIMULACIÓN ESPECIALIZADA':'SPECIALIZED SIMULATION'}</span><b>Xyce · openEMS · Xschem · CACE</b></div><small>{es?'Los controles se habilitan al detectar entradas compatibles.':'Controls become available when compatible inputs are detected.'}</small></div><div className="adapter-grid">{renderAdapterCards('simulation')}</div></section>
    </WizardStep>
    <WizardStep id="physical" number="04" title={es?'Implementación física':'Physical implementation'} summary="RTL → GDSII · LibreLane / OpenROAD" open={openSteps.has('physical')} onToggle={()=>toggleStep('physical')} status={physicalResult?(physicalResult.success?'PASS':'FAIL'):undefined}>{rtlSources.length>0&&['sky130A','gf180mcuD'].includes(project.pdk)?<div className="physical-panel"><div className="physical-toolchain">LibreLane · Yosys · OpenROAD · OpenSTA · Magic · Netgen · KLayout</div><div className="physical-steps">{['Synthesis','Floorplan','Placement','CTS','Routing','Sign-off'].map((stage,index)=><i className={running==='physical'?'active':physicalResult?.success?'done':''} style={running==='physical'?{animationDelay:`${index*.16}s`}:undefined} key={stage}><span>{String(index+1).padStart(2,'0')}</span>{stage}</i>)}</div><div className="physical-config"><label>{es?'Puerto de reloj':'Clock port'}<input value={clockPort} onChange={event=>setClockPort(event.target.value)}/></label><label>{es?'Período (ns)':'Period (ns)'}<input type="number" min="0.1" max="1000" step="0.1" value={clockPeriod} onChange={event=>setClockPeriod(Number(event.target.value))}/></label><label>{es?'Ancho (µm)':'Width (µm)'}<input type="number" min="30" max="5000" value={dieWidth} onChange={event=>setDieWidth(Number(event.target.value))}/></label><label>{es?'Alto (µm)':'Height (µm)'}<input type="number" min="30" max="5000" value={dieHeight} onChange={event=>setDieHeight(Number(event.target.value))}/></label><label>{es?'Utilización (%)':'Utilization (%)'}<input type="number" min="5" max="80" value={utilization} onChange={event=>setUtilization(Number(event.target.value))}/></label><button className={running==='physical'?'running':''} disabled={!!running||worker==='offline'||!tools.librelane?.available} onClick={runPhysical}>{running==='physical'?<><span className="run-spinner"/>{es?'Ejecutando flujo RTL → GDSII':'Running RTL → GDSII flow'}<small>{physicalElapsed}s · {es?'puede tardar varios minutos; no cierre la página':'this can take several minutes; keep this page open'}</small></>:[<span key="label">{es?'Ejecutar flujo completo RTL → GDSII':'Run complete RTL → GDSII flow'}</span>,<small key="tool">LibreLane Classic · {es?'síntesis, colocación, ruteo y sign-off':'synthesis, placement, routing and sign-off'}</small>]}</button></div>{physicalStatus&&<p className="physical-status" aria-live="polite"><span className={running==='physical'?'status-pulse':''}/>{physicalStatus}{running==='physical'?` · ${physicalElapsed}s`:''}</p>}{physicalGds&&<div className="gds3d-action"><div><b>{es?'GDSII listo':'GDSII ready'}</b><small>{physicalGds.name}</small></div><button disabled={!!running||!tools.gds3d?.available} onClick={()=>runAdapter('gds3d')}>{running==='gds3d'?(es?'Validando…':'Validating…'):(es?'Validar en GDS3D':'Validate in GDS3D')}<small>{es?'El visor interactivo está en Resultados':'Interactive viewer is in Results'}</small></button></div>}</div>:<div className="adapter-message">{es?'Disponible para proyectos RTL con SKY130 o GF180.':'Available for RTL projects using SKY130 or GF180.'}</div>}</WizardStep>
    <WizardStep id="results" number="05" title={es?'Resultados y análisis':'Results and analysis'} summary={es?'Gráficas, ondas, layout, consola y artefactos':'Plots, waveforms, layout, console, and artifacts'} open={openSteps.has('results')} onToggle={()=>toggleStep('results')} status={result?.formal_status==='unknown'?'REVIEW':result?.success?'PASS':result?'FAIL':undefined}>{error&&<p className="error">{error}</p>}{result?.simulation&&result.simulation.plots.length>0&&<SpiceViewer data={result.simulation} locale={locale}/>} {waveform&&<WaveformViewer content={waveform.content} locale={locale}/>} {dashboardResult?.summary&&<PhysicalDashboard summary={dashboardResult.summary} artifacts={dashboardResult.artifacts} locale={locale}/>} {result?<div className="console"><div className="console-header"><span>{result.engine} · {result.duration_ms} ms{result.pdk?` · ${result.pdk}`:''}</span><b className={result.formal_status==='unknown'?'unknown':result.success?'success':'failed'}>{result.formal_status==='unknown'?(es?'INCONCLUSO':'INCONCLUSIVE'):result.success?(es?'CORRECTO':'PASSED'):(es?'FALLÓ':'FAILED')} · EXIT {result.exit_code}</b></div><details className="console-output" open={!result.success}><summary>{es?'Registro de ejecución':'Execution log'}</summary><div className="console-tools"><button onClick={()=>selectConsole('result-console-output')}>{es?'Seleccionar todo':'Select all'}</button><button onClick={()=>void copyConsole('result-console-output')}>{copiedConsole==='result-console-output'?(es?'Copiado':'Copied'):(es?'Copiar todo':'Copy all')}</button></div><pre id="result-console-output">{result.output||(es?'La herramienta terminó sin salida.':'The tool completed without output.')}</pre></details>{result.artifacts.length>0&&<ArtifactBrowser artifacts={result.artifacts} locale={locale} onDownload={downloadArtifact}/>}</div>:!error&&!dashboardResult&&<div className="empty-results">{es?'Ejecute una etapa para ver aquí todos sus resultados.':'Run a stage to see all of its results here.'}</div>}</WizardStep>
    </div>
    <aside className={`result-dock ${consoleOpen?'open':''}`} aria-live="polite"><div className="result-dock-bar"><div><span>{stageLabel[activeStage]}</span><b>{running&&ACTION_STAGE[running as Action|'physical']===activeStage?(es?'EJECUTANDO':'RUNNING'):dockResult?.engine??(es?'Sin ejecución todavía':'No run yet')}</b></div>{dockResult&&<em className={dockResult.formal_status==='unknown'?'unknown':dockResult.success?'success':'failed'}>{dockResult.formal_status==='unknown'?(es?'INCONCLUSO':'INCONCLUSIVE'):dockResult.success?'PASS':'FAIL'}{dockResult.exit_code!==undefined?` · EXIT ${dockResult.exit_code}`:''}</em>}<button onClick={()=>selectConsole('dock-console-output')}>{es?'Seleccionar todo':'Select all'}</button><button onClick={()=>void copyConsole('dock-console-output')}>{copiedConsole==='dock-console-output'?(es?'Copiado':'Copied'):(es?'Copiar todo':'Copy all')}</button><button onClick={()=>goStep('results')}>{es?'Abrir análisis':'Open analysis'}</button><button className="dock-toggle" onClick={()=>setConsoleOpen(value=>!value)} aria-label={consoleOpen?(es?'Minimizar consola':'Minimize console'):(es?'Abrir consola':'Open console')}>{consoleOpen?'⌄':'⌃'}</button></div>{consoleOpen&&<pre id="dock-console-output">{running&&ACTION_STAGE[running as Action|'physical']===activeStage?(running==='physical'?`${physicalStatus}\n${es?'Tiempo transcurrido':'Elapsed'}: ${physicalElapsed}s\n${es?'El flujo continúa activo. No cierre esta página.':'The flow is still active. Keep this page open.'}`:`${es?'Ejecutando':'Running'} ${running}…\n${es?'La salida aparecerá aquí al terminar.':'Output will appear here when the run completes.'}`):error&&errorStage===activeStage?error:dockResult?.output||(es?'Esta etapa todavía no tiene una salida. Ejecute una acción para verla aquí.':'This stage has no output yet. Run an action to see it here.')}</pre>}</aside>
  </section>
}
