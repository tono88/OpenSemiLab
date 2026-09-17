import { useMemo, useState } from 'react'
import type { ProjectFile, StoredProject } from './projectStore'

interface RunResult { job_id:string; engine:string; success:boolean; exit_code:number; output:string; duration_ms:number; artifacts:{name:string;media_type:string;content:string}[] }

const HDL_EXTENSIONS=['.sv','.v']

export default function ProjectWorkspace({project,locale,onChange,onClose}:{project:StoredProject;locale:'es'|'en';onChange:(project:StoredProject)=>void;onClose:()=>void}) {
  const es=locale==='es'
  const initial=project.files.find(file=>file.path==='rtl/top.sv')?.path??project.files[0]?.path??''
  const [selectedPath,setSelectedPath]=useState(initial)
  const [running,setRunning]=useState('')
  const [result,setResult]=useState<RunResult|null>(null)
  const [error,setError]=useState('')
  const selected=project.files.find(file=>file.path===selectedPath)??project.files[0]
  const canExecute=['microcontroller','fpga_prototype'].includes(project.kind)
  const groups=useMemo(()=>{
    const grouped:Record<string,ProjectFile[]>={}
    project.files.forEach(file=>{const group=file.path.includes('/')?file.path.split('/')[0]:'project';(grouped[group]??=[]).push(file)})
    return grouped
  },[project.files])

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

  async function run(action:'lint'|'simulate'|'synthesize') {
    setRunning(action);setError('');setResult(null)
    const relevant=project.files.filter(file=>HDL_EXTENSIONS.some(ext=>file.path.endsWith(ext))&&(action==='simulate'||file.role==='source'))
    const sources=Object.fromEntries(relevant.map(file=>[file.path,file.content]))
    try {
      const response=await fetch('/api/v1/eda/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,top:action==='simulate'?'tb_top':'top',sources})})
      const data=await response.json();if(!response.ok) throw new Error(data.detail??'EDA execution failed');setResult(data)
    } catch(reason) {setError(reason instanceof Error?reason.message:'EDA execution failed')}
    finally {setRunning('')}
  }

  return <section className="project-workspace">
    <div className="project-toolbar"><div><span>{es?'PROYECTO ACTIVO':'ACTIVE PROJECT'}</span><h2>{project.name}</h2><small>{project.kind} · {project.pdk} · {es?'guardado localmente':'saved locally'}</small></div><div><button onClick={exportProject}>{es?'Exportar':'Export'}</button><button onClick={onClose}>{es?'Cerrar':'Close'}</button></div></div>
    <div className="project-grid">
      <aside className="file-tree"><div><b>{es?'ARCHIVOS':'FILES'}</b><button onClick={addFile}>＋</button></div>{Object.entries(groups).map(([group,files])=><section key={group}><span>{group}</span>{files.map(file=><button className={file.path===selected?.path?'active':''} onClick={()=>setSelectedPath(file.path)} key={file.path}>{file.path.split('/').pop()}</button>)}</section>)}</aside>
      <div className="file-editor"><div><span>{selected?.path}</span><i>{selected?.role}</i><button onClick={removeFile}>{es?'Eliminar':'Delete'}</button></div><textarea value={selected?.content??''} onChange={event=>updateFile(event.target.value)} spellCheck={false}/></div>
    </div>
    {canExecute?<div className="project-actions"><button disabled={!!running} onClick={()=>run('lint')}>01 · {running==='lint'?(es?'Ejecutando…':'Running…'):(es?'Analizar RTL':'Lint RTL')}</button><button disabled={!!running} onClick={()=>run('simulate')}>02 · {running==='simulate'?(es?'Ejecutando…':'Running…'):(es?'Simular':'Simulate')}</button><button disabled={!!running} onClick={()=>run('synthesize')}>03 · {running==='synthesize'?(es?'Ejecutando…':'Running…'):(es?'Sintetizar':'Synthesize')}</button></div>:<div className="adapter-message">{es?'Los archivos iniciales están listos. La ejecución automatizada de este flujo se conectará en el siguiente adaptador.':'Starter files are ready. Automated execution for this flow will be connected by its next adapter.'}</div>}
    {error&&<p className="error">{error}</p>}
    {result&&<div className="console"><div><span>{result.engine} · {result.duration_ms} ms</span><b className={result.success?'success':'failed'}>{result.success?(es?'CORRECTO':'PASSED'):(es?'FALLÓ':'FAILED')} · EXIT {result.exit_code}</b></div><pre>{result.output}</pre>{result.artifacts.map(artifact=><button key={artifact.name} onClick={()=>{const url=URL.createObjectURL(new Blob([artifact.content],{type:artifact.media_type}));const link=document.createElement('a');link.href=url;link.download=artifact.name;link.click();URL.revokeObjectURL(url)}}>{es?'Descargar':'Download'} {artifact.name} ↓</button>)}</div>}
  </section>
}
