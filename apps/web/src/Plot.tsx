import { useState } from 'react'
import type { PointerEvent } from 'react'
import type { Series } from './types'

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

export function Plot({series,color='#45e6a6',locale='en'}:{series?:Series;color?:string;locale?:'es'|'en'}) {
  const [hoverIndex,setHoverIndex]=useState<number|null>(null)
  if(!series||!series.x.length||!series.y.length) return <div className="plot empty">{locale==='es'?'Ejecute el experimento para visualizar el resultado.':'Run the experiment to see this result.'}</div>

  const length=Math.min(series.x.length,series.y.length)
  const xValues=series.x.slice(0,length),yValues=series.y.slice(0,length)
  const xDomain=extent(xValues),yDomain=extent(yValues)
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
      {selected&&<g className="plot-cursor"><line x1={selected.x} y1={FRAME.top} x2={selected.x} y2={FRAME.bottom}/><circle cx={selected.x} cy={selected.y} r="4" fill={color}/><g transform={`translate(${selected.x>450?selected.x-154:selected.x+10} ${Math.max(24,Math.min(142,selected.y-28))})`}><rect width="144" height="48" rx="2"/><text x="9" y="18">x {numberLabel(selected.xValue)} {series.x_unit}</text><text x="9" y="36">y {numberLabel(selected.yValue)} {series.y_unit}</text></g></g>}
      <text x={(FRAME.left+FRAME.right)/2} y="234" textAnchor="middle" className="axis-title">{series.x_label} ({series.x_unit})</text>
      <text x="13" y={(FRAME.top+FRAME.bottom)/2} textAnchor="middle" transform={`rotate(-90 13 ${(FRAME.top+FRAME.bottom)/2})`} className="axis-title">{series.y_label} ({series.y_unit})</text>
    </svg>
  </div>
}
