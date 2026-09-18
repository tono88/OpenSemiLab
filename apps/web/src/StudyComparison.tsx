import { useMemo } from 'react'
import { Plot } from './Plot'
import type { PlotOverlay } from './Plot'
import type { Series, SimulationResult } from './types'

export interface StudyRun {label:string;result:SimulationResult}

const COLORS=['#73b9e6','#e8bd69','#f08cc6','#b68ae6','#ff8c8c','#80d6c2']

function aggregate(runs:StudyRun[],seriesName:string) {
  const series=runs.map(run=>run.result.series.find(item=>item.name===seriesName)).filter((item):item is Series=>Boolean(item))
  if(!series.length) return null
  const count=Math.min(...series.map(item=>item.y.length))
  const x=series[0].x.slice(0,count)
  const columns=Array.from({length:count},(_,index)=>series.map(item=>item.y[index]))
  const prototype=series[0]
  const make=(name:string,y:number[]):Series=>({...prototype,name,x,y})
  return {
    mean:make('mean',columns.map(values=>values.reduce((sum,value)=>sum+value,0)/values.length)),
    min:make('min',columns.map(values=>Math.min(...values))),
    max:make('max',columns.map(values=>Math.max(...values))),
  }
}

export default function StudyComparison({runs,type,seriesName,locale}:{runs:StudyRun[];type:'corners'|'montecarlo';seriesName:string;locale:'es'|'en'}) {
  const es=locale==='es'
  const selected=runs.map(run=>({label:run.label,series:run.result.series.find(item=>item.name===seriesName)})).filter((item):item is {label:string;series:Series}=>Boolean(item.series))
  const envelope=useMemo(()=>aggregate(runs,seriesName),[runs,seriesName])
  if(!selected.length) return null
  const primary=type==='montecarlo'&&envelope?envelope.mean:selected[0].series
  const overlays:PlotOverlay[]=type==='montecarlo'&&envelope
    ? [{series:envelope.min,color:'#73b9e6',label:es?'Mínimo':'Minimum',dashed:true},{series:envelope.max,color:'#e8bd69',label:es?'Máximo':'Maximum',dashed:true}]
    : selected.slice(1).map((item,index)=>({series:item.series,color:COLORS[index%COLORS.length],label:item.label}))
  return <section className="study-comparison">
    <div className="study-heading"><div><span>{type==='corners'?(es?'ESTUDIO DE ESQUINAS':'CORNER STUDY'):'MONTE CARLO'}</span><b>{type==='corners'?`${runs.length} ${es?'escenarios determinísticos':'deterministic scenarios'}`:`${runs.length} ${es?'muestras estadísticas':'statistical samples'}`}</b></div><small>{type==='montecarlo'?(es?'Media y envolvente min–max · variación educativa reproducible':'Mean and min–max envelope · reproducible educational variation'):(es?'Corners paramétricos educativos; no sustituyen PVT de fundición':'Educational parameter corners; not a substitute for foundry PVT')}</small></div>
    <Plot series={primary} overlays={overlays} color="#45e6a6" locale={locale}/>
  </section>
}
