import { useMemo } from 'react'
import type { Artifact, PhysicalSummary } from './eda-results'

interface DefPreview {width:number;height:number;components:{name:string;x:number;y:number}[]}

function parseDef(content:string):DefPreview|null {
  const units=Number(content.match(/UNITS\s+DISTANCE\s+MICRONS\s+(\d+)/i)?.[1]??1000)
  const die=content.match(/DIEAREA\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)/i)
  if(!die) return null
  const x0=Number(die[1]),y0=Number(die[2]),x1=Number(die[3]),y1=Number(die[4])
  const components:DefPreview['components']=[]
  const block=content.match(/COMPONENTS\s+\d+\s*;([\s\S]*?)END COMPONENTS/i)?.[1]??''
  for(const entry of block.split(';')) {
    const match=entry.match(/-\s+(\S+)\s+\S+[\s\S]*?\+\s+(?:PLACED|FIXED)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)/i)
    if(match) components.push({name:match[1],x:(Number(match[2])-x0)/units,y:(Number(match[3])-y0)/units})
    if(components.length>=4000) break
  }
  return {width:(x1-x0)/units,height:(y1-y0)/units,components}
}

function metric(value:number|null|undefined,digits=2) {return value===null||value===undefined?'—':value.toFixed(digits)}

export default function PhysicalDashboard({summary,artifacts,locale}:{summary:PhysicalSummary;artifacts:Artifact[];locale:'es'|'en'}) {
  const es=locale==='es'
  const def=artifacts.find(artifact=>artifact.name.toLowerCase().endsWith('.def')&&artifact.encoding!=='base64')
  const preview=useMemo(()=>def?parseDef(def.content):null,[def])
  const viewWidth=720,viewHeight=380,padding=24
  const scale=preview?Math.min((viewWidth-padding*2)/preview.width,(viewHeight-padding*2)/preview.height):1
  const chipWidth=preview?preview.width*scale:0,chipHeight=preview?preview.height*scale:0
  const offsetX=(viewWidth-chipWidth)/2,offsetY=(viewHeight-chipHeight)/2

  return <section className="analysis-view physical-dashboard">
    <div className="analysis-title"><div><span>RTL → GDSII</span><b>{es?'Resumen físico':'Physical summary'}</b></div><small>{summary.pdk} · {summary.scl}</small></div>
    <div className="physical-metrics"><div><span>{es?'Área del dado':'Die area'}</span><b>{metric(summary.die_area_um2,0)}</b><small>µm²</small></div><div><span>{es?'Utilización objetivo':'Target utilization'}</span><b>{metric(summary.target_utilization_pct,0)}</b><small>%</small></div><div><span>{es?'Instancias':'Instances'}</span><b>{summary.cell_count??'—'}</b><small>{es?'celdas':'cells'}</small></div><div className={summary.wns_ns!==null&&summary.wns_ns<0?'metric-bad':'metric-good'}><span>WNS</span><b>{metric(summary.wns_ns,3)}</b><small>ns</small></div><div className={summary.tns_ns!==null&&summary.tns_ns<0?'metric-bad':'metric-good'}><span>TNS</span><b>{metric(summary.tns_ns,3)}</b><small>ns</small></div><div className={summary.drc_violations?'metric-bad':'metric-good'}><span>DRC</span><b>{summary.drc_violations??'—'}</b><small>{es?'violaciones':'violations'}</small></div></div>
    <div className="floorplan-preview">{preview?<><div className="preview-heading"><span>{es?'VISTA PREVIA DEF':'DEF PREVIEW'}</span><small>{preview.width.toFixed(1)} × {preview.height.toFixed(1)} µm · {preview.components.length} {es?'colocaciones visibles':'visible placements'}</small></div><svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label={es?'Vista previa del floorplan':'Floorplan preview'}><rect x={offsetX} y={offsetY} width={chipWidth} height={chipHeight} className="die-outline"/>{preview.components.map((component,index)=><rect key={`${component.name}-${index}`} x={offsetX+component.x*scale} y={offsetY+chipHeight-component.y*scale-2} width={Math.max(1.5,scale*.7)} height={Math.max(2,scale*1.3)} className="placed-cell"><title>{component.name}</title></rect>)}</svg></>:<div className="empty-preview"><b>{es?'DEF no disponible':'DEF unavailable'}</b><p>{es?'El resumen métrico permanece disponible; la vista aparecerá cuando LibreLane entregue el DEF final.':'Metrics remain available; the preview appears when LibreLane returns the final DEF.'}</p></div>}</div>
  </section>
}
