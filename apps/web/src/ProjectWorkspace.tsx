import { useEffect, useMemo, useState } from 'react'
import type { ProjectFile, StoredProject } from './projectStore'

interface RunResult { job_id:string; engine:string; success:boolean; exit_code:number; output:string; duration_ms:number; artifacts:{name:string;media_type:string;content:string}[] }

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

export default function ProjectWorkspace({project,locale,onChange,onClose}:{project:StoredProject;locale:'es'|'en';onChange:(project:StoredProject)=>void;onClose:()=>void}) {
  const es=locale==='es'
  const initial=project.files.find(file=>file.path==='rtl/top.sv')?.path??project.files[0]?.path??''
  const [selectedPath,setSelectedPath]=useState(initial)
  const [running,setRunning]=useState('')
  const [result,setResult]=useState<RunResult|null>(null)
  const [error,setError]=useState('')
  const [tools,setTools]=useState<Record<string,ToolState>>({})
  const [worker,setWorker]=useState<'checking'|'online'|'degraded'|'offline'>('checking')
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

  return <section className="project-workspace">
    <div className="project-toolbar"><div><span>{es?'PROYECTO ACTIVO':'ACTIVE PROJECT'}</span><h2>{project.name}</h2><small>{project.kind} · {project.pdk} · {es?'guardado automático en este navegador':'autosaved in this browser'}</small></div><div><button onClick={exportProject}>{es?'Exportar':'Export'}</button><button onClick={onClose}>{es?'Cerrar':'Close'}</button></div></div>
    <div className={`workspace-worker ${worker}`}><i/>{worker==='online'?(es?'IIC-OSIC listo para ejecutar':'IIC-OSIC ready to run'):worker==='degraded'?(es?'Worker conectado; algunas herramientas no están disponibles':'Worker connected; some tools are unavailable'):worker==='checking'?(es?'Comprobando herramientas…':'Checking tools…'):(es?'Worker desconectado':'Worker offline')}<button onClick={refreshCapabilities}>{es?'Comprobar':'Check'}</button></div>
    <div className="project-grid">
      <aside className="file-tree"><div><b>{es?'ARCHIVOS':'FILES'}</b><button onClick={addFile}>＋</button></div>{Object.entries(groups).map(([group,files])=><section key={group}><span>{group}</span>{files.map(file=><button className={file.path===selected?.path?'active':''} onClick={()=>setSelectedPath(file.path)} key={file.path}>{file.path.split('/').pop()}</button>)}</section>)}</aside>
      <div className="file-editor"><div><span>{selected?.path}</span><i>{selected?.role}</i><button onClick={removeFile}>{es?'Eliminar':'Delete'}</button></div><textarea value={selected?.content??''} onChange={event=>updateFile(event.target.value)} spellCheck={false}/></div>
    </div>
    {(rtlSources.length||spiceSources.length)?<div className="execution-panel"><div><b>{es?'EJECUCIÓN DEL PROYECTO':'PROJECT EXECUTION'}</b><small>{execution.rtlTop?`RTL top: ${execution.rtlTop}`:''}{execution.spiceEntry?` · SPICE: ${execution.spiceEntry}`:''}</small></div><div className="project-actions">{rtlSources.length>0&&<button disabled={!!running||worker==='offline'||!(tools.verible_lint?.available||tools.verilator?.available)} onClick={()=>run('lint')}>01 · {running==='lint'?(es?'Ejecutando…':'Running…'):(es?'Analizar RTL':'Lint RTL')}<small>{tools.verible_lint?.available?'Verible':'Verilator'}</small></button>}{testbenches.length>0&&<button disabled={!!running||worker==='offline'||!(tools.iverilog?.available&&tools.vvp?.available)} onClick={()=>run('simulate')}>02 · {running==='simulate'?(es?'Ejecutando…':'Running…'):(es?'Simular RTL':'Simulate RTL')}<small>Icarus Verilog</small></button>}{rtlSources.length>0&&<button disabled={!!running||worker==='offline'||!tools.yosys?.available} onClick={()=>run('synthesize')}>03 · {running==='synthesize'?(es?'Ejecutando…':'Running…'):(es?'Sintetizar':'Synthesize')}<small>Yosys</small></button>}{spiceEntry&&<button disabled={!!running||worker==='offline'||!tools.ngspice?.available} onClick={()=>run('spice')}>04 · {running==='spice'?(es?'Ejecutando…':'Running…'):(es?'Simular SPICE':'Simulate SPICE')}<small>ngspice</small></button>}</div></div>:<div className="adapter-message">{es?'Este proyecto aún no contiene archivos ejecutables.':'This project does not contain executable files yet.'}</div>}
    {error&&<p className="error">{error}</p>}
    {result&&<div className="console"><div><span>{result.engine} · {result.duration_ms} ms</span><b className={result.success?'success':'failed'}>{result.success?(es?'CORRECTO':'PASSED'):(es?'FALLÓ':'FAILED')} · EXIT {result.exit_code}</b></div><pre>{result.output}</pre>{result.artifacts.map(artifact=><button key={artifact.name} onClick={()=>{const url=URL.createObjectURL(new Blob([artifact.content],{type:artifact.media_type}));const link=document.createElement('a');link.href=url;link.download=artifact.name;link.click();URL.revokeObjectURL(url)}}>{es?'Descargar':'Download'} {artifact.name} ↓</button>)}</div>}
  </section>
}
