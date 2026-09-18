import { useMemo, useState } from 'react'
import { Plot } from './Plot'
import type { SimulationData } from './eda-results'

export default function SpiceViewer({data,locale}:{data:SimulationData;locale:'es'|'en'}) {
  const es=locale==='es'
  const [plotIndex,setPlotIndex]=useState(0)
  const [seriesName,setSeriesName]=useState('')
  const plot=data.plots[Math.min(plotIndex,Math.max(0,data.plots.length-1))]
  const series=useMemo(()=>plot?.series.find(item=>item.name===seriesName)??plot?.series[0],[plot,seriesName])
  if(!plot) return <section className="analysis-view empty-analysis"><b>{es?'Sin vectores gráficos':'No chart vectors'}</b><p>{es?'Agregue una directiva .print dc, .print tran, .print ac o .print noise al banco SPICE.':'Add a .print dc, .print tran, .print ac, or .print noise directive to the SPICE testbench.'}</p></section>

  return <section className="analysis-view spice-viewer">
    <div className="analysis-title"><div><span>SPICE</span><b>{es?'Análisis numérico':'Numeric analysis'}</b></div><small>{data.engine} · {plot.analysis}</small></div>
    {data.plots.length>1&&<div className="analysis-tabs">{data.plots.map((item,index)=><button className={plotIndex===index?'active':''} onClick={()=>{setPlotIndex(index);setSeriesName('')}} key={`${item.name}-${index}`}>{item.name}</button>)}</div>}
    <div className="signal-tabs">{plot.series.map(item=><button className={series?.name===item.name?'active':''} onClick={()=>setSeriesName(item.name)} key={item.name}>{item.name}</button>)}</div>
    <Plot series={series} locale={locale}/>
  </section>
}
