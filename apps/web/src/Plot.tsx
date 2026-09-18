import { useState } from 'react'
import type { PointerEvent } from 'react'
import type { Series } from './types'

export interface PlotOverlay {series:Series;color:string;label:string;dashed?:boolean}

const FRAME={left:62,right:598,top:18,bottom:196}

function extent(values:number[]):[number,number] {
  const min=Math.min(...values),max=Math.max(...values)
  if(min!==max) return [min,max]
  const padding=Math.abs(min)*.05||1
  return [min-padding,max+padding]
}

function position(value:number,domain:[number,number],start:number,end:number) {
  return start+((value-domain[0])/(domain[1]-domain[0]))*(end-start)
}

function ticks(domain:[number,number],count=5) {
  return Array.from({length:count},(_,index)=>domain[0]+((domain[1]-domain[0])*index)/(count-1))
}

function numberLabel(value:number) {
  const absolute=Math.abs(value)
  if(absolute>=10_000||(absolute>0&&absolute<.001)) return value.toExponential(1)
  if(absolute>=100) return value.toFixed(0)
  if(absolute>=1) return value.toFixed(2).replace(/\.00$/,'')
  return value.toFixed(3).replace(/0+$/,'').replace(/\.$/,'')
}

export function Plot({series,color='#45e6a6',locale='en',overlays=[]}:{series?:Series;color?:string;locale?:'es'|'en';overlays?:PlotOverlay[]}) {
  const [hoverIndex,setHoverIndex]=useState<number|null>(null)
  if(!series||!series.x.length||!series.y.length) return <div className="plot empty">{locale==='es'?'Ejecute el experimento para visualizar el resultado.':'Run the experiment to see this result.'}</div>

  const length=Math.min(series.x.length,series.y.length)
  const xValues=series.x.slice(0,length),yValues=series.y.slice(0,length)
  const compared=[series,...overlays.map(overlay=>overlay.series)]
  const xDomain=extent(compared.flatMap(item=>item.x)),yDomain=extent(compared.flatMap(item=>item.y))
  const xs=xValues.map(value=>position(value,xDomain,FRAME.left,FRAME.right))
  const ys=yValues.map(value=>position(value,yDomain,FRAME.bottom,FRAME.top))
  const points=xs.map((x,index)=>`${x},${ys[index]}`).join(' ')
  const zeroY=yDomain[0]<=0&&yDomain[1]>=0?position(0,yDomain,FRAME.bottom,FRAME.top):FRAME.bottom
  const areaPoints=`${xs[0]},${zeroY} ${points} ${xs[xs.length-1]},${zeroY}`
  const xTicks=ticks(xDomain),yTicks=ticks(yDomain)
  const activeIndex=hoverIndex!==null&&hoverIndex<length?hoverIndex:null
  const selected=activeIndex===null?null:{x:xs[activeIndex],y:ys[activeIndex],xValue:xValues[activeIndex],yValue:yValues[activeIndex]}

  function inspect(event:PointerEvent<SVGSVGElement>) {
    const bounds=event.currentTarget.getBoundingClientRect()
    const pointerX=((event.clientX-bounds.left)/bounds.width)*620
    let nearest=0
    for(let index=1;index<xs.length;index+=1) if(Math.abs(xs[index]-pointerX)<Math.abs(xs[nearest]-pointerX)) nearest=index
    setHoverIndex(nearest)
  }

  return <div className="plot plot-interactive">
    <svg viewBox="0 0 620 238" role="img" aria-label={`${series.y_label} by ${series.x_label}`} onPointerMove={inspect} onPointerLeave={()=>setHoverIndex(null)}>
      <defs><linearGradient id={`plot-fill-${series.name}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".25"/><stop offset="1" stopColor={color} stopOpacity=".015"/></linearGradient></defs>
      {yTicks.map(value=>{const y=position(value,yDomain,FRAME.bottom,FRAME.top);return <g key={`y-${value}`}><line x1={FRAME.left} y1={y} x2={FRAME.right} y2={y} className="grid"/><text x={FRAME.left-9} y={y+3} textAnchor="end" className="tick-label">{numberLabel(value)}</text></g>})}
      {xTicks.map(value=>{const x=position(value,xDomain,FRAME.left,FRAME.right);return <g key={`x-${value}`}><line x1={x} y1={FRAME.top} x2={x} y2={FRAME.bottom} className="grid"/><text x={x} y={FRAME.bottom+16} textAnchor="middle" className="tick-label">{numberLabel(value)}</text></g>})}
      {yDomain[0]<0&&yDomain[1]>0&&<line x1={FRAME.left} y1={zeroY} x2={FRAME.right} y2={zeroY} className="zero-line"/>}
      <line x1={FRAME.left} y1={FRAME.top} x2={FRAME.left} y2={FRAME.bottom} className="axis"/><line x1={FRAME.left} y1={FRAME.bottom} x2={FRAME.right} y2={FRAME.bottom} className="axis"/>
      <polygon points={areaPoints} fill={`url(#plot-fill-${series.name})`}/>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      {overlays.map((overlay,index)=>{const count=Math.min(overlay.series.x.length,overlay.series.y.length);const overlayPoints=overlay.series.x.slice(0,count).map((value,point)=>`${position(value,xDomain,FRAME.left,FRAME.right)},${position(overlay.series.y[point],yDomain,FRAME.bottom,FRAME.top)}`).join(' ');return <polyline key={`${overlay.label}-${index}`} points={overlayPoints} fill="none" stroke={overlay.color} strokeWidth="1.7" strokeOpacity=".9" strokeDasharray={overlay.dashed?'5 4':undefined} strokeLinejoin="round"/>})}
      {selected&&<g className="plot-cursor"><line x1={selected.x} y1={FRAME.top} x2={selected.x} y2={FRAME.bottom}/><circle cx={selected.x} cy={selected.y} r="4" fill={color}/><g transform={`translate(${selected.x>450?selected.x-154:selected.x+10} ${Math.max(24,Math.min(142,selected.y-28))})`}><rect width="144" height="48" rx="2"/><text x="9" y="18">x {numberLabel(selected.xValue)} {series.x_unit}</text><text x="9" y="36">y {numberLabel(selected.yValue)} {series.y_unit}</text></g></g>}
      <text x={(FRAME.left+FRAME.right)/2} y="234" textAnchor="middle" className="axis-title">{series.x_label} ({series.x_unit})</text>
      <text x="13" y={(FRAME.top+FRAME.bottom)/2} textAnchor="middle" transform={`rotate(-90 13 ${(FRAME.top+FRAME.bottom)/2})`} className="axis-title">{series.y_label} ({series.y_unit})</text>
    </svg>
    {overlays.length>0&&<div className="plot-legend"><span><i style={{background:color}}/>{series.name}</span>{overlays.map((overlay,index)=><span key={`${overlay.label}-${index}`}><i style={{background:overlay.color}}/>{overlay.label}</span>)}</div>}
  </div>
}
