import { useState } from 'react'
import type { RunSnapshot } from './eda-results'

function value(value:number|null|undefined,digits=3) {return value===null||value===undefined?'—':value.toFixed(digits)}

export default function RunHistory({runs,locale,onClear}:{runs:RunSnapshot[];locale:'es'|'en';onClear:()=>void}) {
  const es=locale==='es'
  const [selected,setSelected]=useState<string[]>([])
  if(!runs.length) return null
  const effective=selected.filter(id=>runs.some(run=>run.id===id))
  const compared=(effective.length?effective:runs.slice(0,Math.min(3,runs.length)).map(run=>run.id)).map(id=>runs.find(run=>run.id===id)!).filter(Boolean)
  function toggle(id:string) {const base=effective.length?effective:compared.map(run=>run.id);setSelected(base.includes(id)?base.filter(item=>item!==id):base.length<4?[...base,id]:base)}
  return <section className="run-history analysis-view">
    <div className="analysis-title"><div><span>{es?'COMPARACIÓN':'COMPARISON'}</span><b>{es?'Historial de ejecuciones':'Run history'}</b></div><button onClick={onClear}>{es?'Eliminar':'Delete'}</button></div>
    <div className="run-selector">{runs.map(run=><button className={compared.some(item=>item.id===run.id)?'active':''} onClick={()=>toggle(run.id)} key={run.id}><i className={run.formal_status==='unknown'?'warn':run.success?'ok':'bad'}/><b>{run.action}</b><span>{run.engine}</span><small>{new Date(run.createdAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})} · {run.duration_ms} ms</small></button>)}</div>
    <div className="comparison-table"><table><thead><tr><th>{es?'Métrica':'Metric'}</th>{compared.map(run=><th key={run.id}>{run.action}<small>{run.id}</small></th>)}</tr></thead><tbody><tr><td>{es?'Estado':'Status'}</td>{compared.map(run=><td key={run.id}>{run.formal_status==='unknown'?(es?'Inconcluso':'Inconclusive'):run.success?(es?'Correcto':'Passed'):(es?'Falló':'Failed')}</td>)}</tr><tr><td>WNS (ns)</td>{compared.map(run=><td key={run.id}>{value(run.summary?.wns_ns)}</td>)}</tr><tr><td>TNS (ns)</td>{compared.map(run=><td key={run.id}>{value(run.summary?.tns_ns)}</td>)}</tr><tr><td>DRC</td>{compared.map(run=><td key={run.id}>{run.summary?.drc_violations??'—'}</td>)}</tr><tr><td>{es?'Área':'Area'} (µm²)</td>{compared.map(run=><td key={run.id}>{value(run.summary?.die_area_um2,0)}</td>)}</tr><tr><td>{es?'Curvas SPICE':'SPICE traces'}</td>{compared.map(run=><td key={run.id}>{run.simulation?.plots.reduce((sum,plot)=>sum+plot.series.length,0)??'—'}</td>)}</tr></tbody></table></div>
  </section>
}
