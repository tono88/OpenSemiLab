import { useEffect, useState } from 'react'
import './pdk-manager.css'

export interface PrivatePdk {
  id:string
  display_name:string
  version:string
  process:string
  stack:string
  imported_at:string
  archive_count:number
  file_count:number
  size_bytes:number
  inventory:Record<string,number>
  readiness:Record<string,boolean>
  warnings:string[]
}

const READINESS=['simulation','synthesis_timing','physical','drc','lvs','pex']

export default function PdkManager({locale,onSelect,onProfilesChange}:{locale:'es'|'en';onSelect:(pdk:PrivatePdk)=>void;onProfilesChange:(pdks:PrivatePdk[])=>void}) {
  const es=locale==='es'
  const [pdks,setPdks]=useState<PrivatePdk[]>([])
  const [name,setName]=useState('')
  const [version,setVersion]=useState('')
  const [process,setProcess]=useState('')
  const [stack,setStack]=useState('')
  const [files,setFiles]=useState<File[]>([])
  const [authorized,setAuthorized]=useState(false)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')

  async function refresh() {
    try {
      const response=await fetch('/api/v1/pdks')
      if(!response.ok)throw new Error()
      const next=await response.json() as PrivatePdk[]
      setPdks(next);onProfilesChange(next)
    } catch {setMessage(es?'No se pudo leer el registro privado de PDK.':'Could not read the private PDK registry.')}
  }
  useEffect(()=>{void refresh()},[])

  async function upload() {
    if(!name.trim()||!version.trim()||!process.trim()||!stack.trim()||!files.length||!authorized) {
      setMessage(es?'Complete los datos, seleccione al menos un paquete y confirme la autorización.':'Complete the fields, select at least one package, and confirm authorization.')
      return
    }
    setBusy(true);setMessage(es?'Importando y analizando localmente…':'Importing and scanning locally…')
    const form=new FormData()
    form.set('display_name',name.trim());form.set('version',version.trim());form.set('process',process.trim());form.set('stack',stack.trim());form.set('license_acknowledged','true')
    files.forEach(file=>form.append('files',file))
    try {
      const response=await fetch('/api/v1/pdks/import',{method:'POST',body:form})
      const body=await response.json()
      if(!response.ok)throw new Error(body.detail??'Import failed')
      setName('');setVersion('');setProcess('');setStack('');setFiles([]);setAuthorized(false)
      setMessage(es?'PDK importado. Revise la matriz antes de usarlo.':'PDK imported. Review the readiness matrix before using it.')
      await refresh()
    } catch(reason) {setMessage(reason instanceof Error?reason.message:(es?'Falló la importación.':'Import failed.'))}
    finally {setBusy(false)}
  }

  async function remove(pdk:PrivatePdk) {
    if(!window.confirm(es?`¿Eliminar ${pdk.display_name} ${pdk.version} del almacenamiento privado?`:`Delete ${pdk.display_name} ${pdk.version} from private storage?`))return
    const response=await fetch(`/api/v1/pdks/${encodeURIComponent(pdk.id)}`,{method:'DELETE'})
    if(!response.ok) {setMessage(es?'No se pudo eliminar el PDK.':'Could not delete the PDK.');return}
    setMessage(es?'PDK eliminado del volumen privado.':'PDK deleted from the private volume.')
    await refresh()
  }

  return <section className="private-pdk-panel">
    <div className="private-pdk-heading"><div><span>BYOPDK</span><b>{es?'Tecnologías privadas':'Private technologies'}</b><small>{es?'Los paquetes permanecen en el servidor local y nunca se agregan al proyecto exportado ni al repositorio.':'Packages remain on the local server and are never added to exported projects or the repository.'}</small></div><em>{pdks.length} {es?'instalados':'installed'}</em></div>
    <details className="pdk-importer"><summary>{es?'Importar un PDK privado':'Import a private PDK'} <span>＋</span></summary>
      <div className="pdk-form">
        <label>{es?'Nombre visible':'Display name'}<input value={name} maxLength={100} onChange={event=>setName(event.target.value)} placeholder={es?'Tecnología privada':'Private technology'}/></label>
        <label>{es?'Versión':'Version'}<input value={version} maxLength={100} onChange={event=>setVersion(event.target.value)} placeholder="1.0"/></label>
        <label>{es?'Proceso / nodo':'Process / node'}<input value={process} maxLength={100} onChange={event=>setProcess(event.target.value)} placeholder="180 nm"/></label>
        <label>{es?'Stack / opción metálica':'Stack / metal option'}<input value={stack} maxLength={100} onChange={event=>setStack(event.target.value)} placeholder="1P5M"/></label>
        <label className="pdk-files">{es?'Paquetes del PDK':'PDK packages'}<input type="file" multiple accept=".zip,.tar,.gz,.tgz,.bz2,.xz,.lib,.lef,.v,.sv,.gds,.gdsii,.oas,.spice,.cir,.cdl,.json" onChange={event=>setFiles(Array.from(event.target.files??[]))}/><small>{files.length?`${files.length} ${es?'archivo(s) seleccionado(s)':'file(s) selected'}`:(es?'ZIP, TAR.GZ, TGZ o vistas individuales':'ZIP, TAR.GZ, TGZ, or individual views')}</small></label>
        <label className="pdk-license"><input type="checkbox" checked={authorized} onChange={event=>setAuthorized(event.target.checked)}/><span>{es?'Confirmo que tengo autorización para usar estos archivos y que sus licencias permiten procesarlos en esta instalación.':'I confirm I am authorized to use these files and their licenses permit processing them in this installation.'}</span></label>
        <button disabled={busy} onClick={()=>void upload()}>{busy?(es?'Analizando…':'Scanning…'):(es?'Importar y validar':'Import and validate')}</button>
      </div>
    </details>
    {message&&<p className="pdk-message" aria-live="polite">{message}</p>}
    {pdks.length>0&&<div className="private-pdk-list">{pdks.map(pdk=><article key={pdk.id}>
      <div className="pdk-card-title"><div><b>{pdk.display_name}</b><span>{pdk.version} · {pdk.process} · {pdk.stack}</span></div><button className="pdk-delete" onClick={()=>void remove(pdk)} title={es?'Eliminar':'Delete'}>×</button></div>
      <div className="pdk-readiness">{READINESS.map(key=><span className={pdk.readiness[key]?'ready':'pending'} key={key}>{pdk.readiness[key]?'✓':'○'} {key.replace('_',' ')}</span>)}</div>
      <small>{pdk.file_count.toLocaleString(locale)} {es?'archivos':'files'} · {(pdk.size_bytes/1024/1024).toFixed(1)} MB · {Object.entries(pdk.inventory).map(([key,count])=>`${key}:${count}`).join(' · ')|| (es?'sin vistas reconocidas':'no recognized views')}</small>
      {pdk.warnings.length>0&&<details className="pdk-warnings"><summary>{pdk.warnings.length} {es?'observaciones':'notices'}</summary>{pdk.warnings.map(item=><p key={item}>{item}</p>)}</details>}
      <button className="pdk-select" onClick={()=>onSelect(pdk)}>{es?'Usar en el proyecto':'Use in project'} →</button>
    </article>)}</div>}
  </section>
}
