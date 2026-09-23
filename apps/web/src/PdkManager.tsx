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
  conversion:{status:string;stack_variants:string[];selected_stack:string|null;generated_at:string|null;blockers:string[];normalized_views?:Record<string,number>;view_consistency?:{lef_cells:number;liberty_cells:number;verilog_modules:number;common_cells:number;consistent:boolean};compile_id?:string;bundle_available?:boolean;bundle_size_bytes?:number;bundle_sha256?:string;platform_analysis?:{routing_layer_count:number;site_count:number;power_pin_count:number;ground_pin_count:number}}
}

const READINESS=['simulation','synthesis_timing','openroad_inputs','physical','drc','lvs','pex']
const BLOCKERS:Record<string,[string,string]>={
  exact_stack_required:['Seleccione la variante metálica exacta.','Select the exact metal-stack variant.'],
  technology_lef_missing:['Falta el LEF tecnológico.','Technology LEF is missing.'],
  cell_lef_missing:['Falta el LEF de celdas estándar.','Standard-cell LEF is missing.'],
  liberty_missing:['Faltan bibliotecas Liberty.','Liberty timing libraries are missing.'],
  verilog_models_missing:['Faltan modelos Verilog de celdas.','Cell Verilog models are missing.'],
  cell_layout_missing:['Falta GDS/OASIS de las celdas estándar.','Standard-cell GDS/OASIS is missing.'],
  streamout_map_missing:['Falta el mapa tecnológico de stream-out para KLayout.','KLayout stream-out technology map is missing.'],
  klayout_tech_validation_required:['Se detectó un mapa del proveedor, pero falta validarlo y guardarlo como tecnología .lyt de KLayout.','A vendor layer map was detected, but it still must be validated and saved as a KLayout .lyt technology.'],
  open_drc_deck_missing:['Falta un deck DRC abierto y validado.','A validated open DRC deck is missing.'],
  open_lvs_deck_missing:['Falta un deck LVS abierto y validado.','A validated open LVS deck is missing.'],
  cell_lvs_netlist_missing:['Falta el netlist CDL/SPI de las celdas estándar para LVS.','The standard-cell CDL/SPI netlist required for LVS is missing.'],
  open_rcx_rules_missing:['Faltan reglas OpenRCX calibradas.','Calibrated OpenRCX rules are missing.'],
  cell_views_inconsistent:['Las celdas no coinciden entre LEF, Liberty y Verilog.','Cell names do not match across LEF, Liberty, and Verilog.'],
  platform_config_validation_required:['Falta completar y validar la configuración de plataforma: pines de alimentación, celdas tie/buffer, sitio, capas de ruteo, tracks y PDN.','Platform configuration still needs validation: power pins, tie/buffer cells, placement site, routing layers, tracks, and PDN.'],
}

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
  const [converting,setConverting]=useState('')
  const [stackChoices,setStackChoices]=useState<Record<string,string>>({})
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
      const raw=await response.text()
      let body:{detail?:string}={}
      try {body=raw?JSON.parse(raw):{}}
      catch {
        if(response.status===413)throw new Error(es?'El paquete supera el límite de carga del servidor. Reconstruya el servicio web con la configuración BYOPDK actualizada.':'The package exceeds the server upload limit. Rebuild the web service with the updated BYOPDK configuration.')
        throw new Error(es?`El servidor devolvió una respuesta no válida (HTTP ${response.status}).`:`The server returned an invalid response (HTTP ${response.status}).`)
      }
      if(!response.ok)throw new Error(body.detail??(es?'Falló la importación.':'Import failed.'))
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

  async function convert(pdk:PrivatePdk) {
    const selected=stackChoices[pdk.id]||pdk.conversion.selected_stack||''
    if(pdk.conversion.stack_variants.length>1&&!selected) {setMessage(es?'Seleccione primero la variante metálica exacta.':'Select the exact metal-stack variant first.');return}
    setConverting(pdk.id);setMessage(es?'Preparando y validando el adaptador local…':'Preparing and validating the local adapter…')
    try {
      const response=await fetch(`/api/v1/pdks/${encodeURIComponent(pdk.id)}/convert`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stack_variant:selected||null})})
      const body=await response.json() as {detail?:string}
      if(!response.ok)throw new Error(body.detail??(es?'Falló la conversión.':'Conversion failed.'))
      setMessage(es?'Adaptador generado. Revise los bloqueos antes de ejecutar el flujo físico.':'Adapter generated. Review blockers before running the physical flow.')
      await refresh()
    } catch(reason) {setMessage(reason instanceof Error?reason.message:(es?'Falló la conversión.':'Conversion failed.'))}
    finally {setConverting('')}
  }

  async function addViews(pdk:PrivatePdk, additions:File[]) {
    if(!additions.length)return
    if(!window.confirm(es?'¿Confirma que tiene autorización para procesar estas vistas adicionales en esta instalación?':'Do you confirm you are authorized to process these supplementary views in this installation?'))return
    setConverting(pdk.id);setMessage(es?'Añadiendo y analizando las vistas…':'Adding and scanning views…')
    const form=new FormData();form.set('license_acknowledged','true');additions.forEach(file=>form.append('files',file))
    try {
      const response=await fetch(`/api/v1/pdks/${encodeURIComponent(pdk.id)}/files`,{method:'POST',body:form})
      const body=await response.json() as {detail?:string}
      if(!response.ok)throw new Error(body.detail??(es?'No se pudieron añadir las vistas.':'Could not add the views.'))
      setMessage(es?'Vistas añadidas y adaptador recompilado en el servidor.':'Views added and adapter recompiled on the server.')
      await refresh()
    } catch(reason) {setMessage(reason instanceof Error?reason.message:(es?'No se pudieron añadir las vistas.':'Could not add the views.'))}
    finally {setConverting('')}
  }

  return <section className="private-pdk-panel">
    <div className="private-pdk-heading"><div><span>BYOPDK</span><b>{es?'Tecnologías privadas':'Private technologies'}</b><small>{es?'Los paquetes permanecen en el servidor local y nunca se agregan al proyecto exportado ni al repositorio.':'Packages remain on the local server and are never added to exported projects or the repository.'}</small></div><em>{pdks.length} {es?'instalados':'installed'}</em></div>
    <details className="pdk-importer"><summary>{es?'Importar un PDK privado':'Import a private PDK'} <span>＋</span></summary>
      <div className="pdk-form">
        <label>{es?'Nombre visible':'Display name'}<input value={name} maxLength={100} onChange={event=>setName(event.target.value)} placeholder={es?'Tecnología privada':'Private technology'}/></label>
        <label>{es?'Versión':'Version'}<input value={version} maxLength={100} onChange={event=>setVersion(event.target.value)} placeholder="1.0"/></label>
        <label>{es?'Proceso / nodo':'Process / node'}<input value={process} maxLength={100} onChange={event=>setProcess(event.target.value)} placeholder="180 nm"/></label>
        <label>{es?'Stack / opción metálica':'Stack / metal option'}<input value={stack} maxLength={100} onChange={event=>setStack(event.target.value)} placeholder="1P5M"/></label>
        <label className="pdk-files">{es?'Paquetes del PDK':'PDK packages'}<input type="file" multiple accept=".zip,.tar,.gz,.tgz,.bz2,.xz,.lib,.db,.lef,.tlef,.v,.sv,.gds,.gdsii,.oas,.oasis,.spice,.cir,.cdl,.json,.lyt,.lyp,.lydrc,.lylvs,.map,.tf,.tluplus,.tcl,.rules" onChange={event=>setFiles(Array.from(event.target.files??[]))}/><small>{files.length?`${files.length} ${es?'archivo(s) seleccionado(s)':'file(s) selected'}`:(es?'ZIP, TAR.GZ, TGZ o vistas individuales':'ZIP, TAR.GZ, TGZ, or individual views')}</small></label>
        <label className="pdk-license"><input type="checkbox" checked={authorized} onChange={event=>setAuthorized(event.target.checked)}/><span>{es?'Confirmo que tengo autorización para usar estos archivos y que sus licencias permiten procesarlos en esta instalación.':'I confirm I am authorized to use these files and their licenses permit processing them in this installation.'}</span></label>
        <button disabled={busy} onClick={()=>void upload()}>{busy?(es?'Analizando…':'Scanning…'):(es?'Importar y validar':'Import and validate')}</button>
      </div>
    </details>
    {message&&<p className="pdk-message" aria-live="polite">{message}</p>}
    {pdks.length>0&&<div className="private-pdk-list">{pdks.map(pdk=><article key={pdk.id}>
      <div className="pdk-card-title"><div><b>{pdk.display_name}</b><span>{pdk.version} · {pdk.process} · {pdk.stack}</span></div><button className="pdk-delete" onClick={()=>void remove(pdk)} title={es?'Eliminar':'Delete'}>×</button></div>
      <div className="pdk-readiness">{READINESS.map(key=><span className={pdk.readiness[key]?'ready':'pending'} key={key}>{pdk.readiness[key]?'✓':'○'} {key.replaceAll('_',' ')}</span>)}</div>
      <small>{pdk.file_count.toLocaleString(locale)} {es?'archivos':'files'} · {(pdk.size_bytes/1024/1024).toFixed(1)} MB · {Object.entries(pdk.inventory).map(([key,count])=>`${key}:${count}`).join(' · ')|| (es?'sin vistas reconocidas':'no recognized views')}</small>
      {pdk.warnings.length>0&&<details className="pdk-warnings"><summary>{pdk.warnings.length} {es?'observaciones':'notices'}</summary>{pdk.warnings.map(item=><p key={item}>{item}</p>)}</details>}
      <section className="pdk-converter">
        <div><b>{es?'Conversión Synopsys → flujo abierto':'Synopsys → open-flow conversion'}</b><span className={`conversion-state ${pdk.conversion.status}`}>{pdk.conversion.status.replaceAll('_',' ')}</span></div>
        {pdk.conversion.stack_variants.length>1&&<label>{es?'Stack tecnológico exacto':'Exact technology stack'}<select value={stackChoices[pdk.id]??pdk.conversion.selected_stack??''} onChange={event=>setStackChoices(current=>({...current,[pdk.id]:event.target.value}))}><option value="">{es?'Seleccionar…':'Select…'}</option>{pdk.conversion.stack_variants.map(item=><option value={item} key={item}>{item}</option>)}</select></label>}
        {pdk.conversion.stack_variants.length===1&&<small>{es?'Stack detectado':'Detected stack'}: {pdk.conversion.stack_variants[0]}</small>}
        {pdk.conversion.view_consistency&&<small>{es?'Cobertura de celdas':'Cell coverage'}: LEF {pdk.conversion.view_consistency.lef_cells} · Liberty {pdk.conversion.view_consistency.liberty_cells} · Verilog {pdk.conversion.view_consistency.verilog_modules} · {es?'comunes':'common'} {pdk.conversion.view_consistency.common_cells}</small>}
        {pdk.conversion.platform_analysis&&<small>{es?'Configuración inferida':'Inferred configuration'}: {pdk.conversion.platform_analysis.routing_layer_count} {es?'capas':'layers'} · {pdk.conversion.platform_analysis.site_count} site · {pdk.conversion.platform_analysis.power_pin_count}/{pdk.conversion.platform_analysis.ground_pin_count} power/ground</small>}
        {pdk.conversion.blockers.length>0&&<details className="pdk-blockers" open={pdk.conversion.status!=='not_started'}><summary>{pdk.conversion.blockers.length} {es?'requisitos pendientes':'pending requirements'}</summary>{pdk.conversion.blockers.map(code=><p key={code}>{(BLOCKERS[code]??[code,code])[es?0:1]}</p>)}</details>}
        {!pdk.readiness.physical&&<button disabled={converting===pdk.id} onClick={()=>void convert(pdk)}>{converting===pdk.id?(es?'Convirtiendo…':'Converting…'):(pdk.conversion.status==='not_started'?(es?'Preparar adaptador abierto':'Prepare open adapter'):(es?'Regenerar adaptador':'Regenerate adapter'))}</button>}
        {pdk.conversion.bundle_available&&<a className="pdk-download" href={`/api/v1/pdks/${encodeURIComponent(pdk.id)}/bundle`} download>{es?'Descargar PDK recompilado':'Download compiled PDK'}{pdk.conversion.bundle_size_bytes?` · ${(pdk.conversion.bundle_size_bytes/1024/1024).toFixed(1)} MB`:''}</a>}
        <label className="pdk-supplement">{es?'Añadir vistas faltantes (GDS, reglas o mapas)':'Add missing views (GDS, rules, or maps)'}<input disabled={converting===pdk.id} type="file" multiple accept=".zip,.tar,.gz,.tgz,.bz2,.xz,.lib,.db,.lef,.tlef,.v,.sv,.gds,.gdsii,.oas,.oasis,.spice,.cir,.cdl,.lyt,.lyp,.lydrc,.lylvs,.map,.tf,.tluplus,.tcl,.rules" onChange={event=>{void addViews(pdk,Array.from(event.target.files??[]));event.currentTarget.value=''}}/></label>
      </section>
      <button className="pdk-select" onClick={()=>onSelect(pdk)}>{es?'Usar en el proyecto':'Use in project'} →</button>
    </article>)}</div>}
  </section>
}
