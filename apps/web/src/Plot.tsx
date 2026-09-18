import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import type { Series } from './types'

export interface PlotOverlay {series:Series;color:string;label:string;dashed?:boolean}
const FRAME={left:62,right:598,top:18,bottom:196}
const extent=(values:number[]):[number,number]=>{const min=Math.min(...values),max=Math.max(...values);if(min!==max)return[min,max];const padding=Math.abs(min)*.05||1;return[min-padding,max+padding]}
const position=(value:number,domain:[number,number],start:number,end:number)=>start+((value-domain[0])/(domain[1]-domain[0]))*(end-start)
const ticks=(domain:[number,number],count=5)=>Array.from({length:count},(_,index)=>domain[0]+((domain[1]-domain[0])*index)/(count-1))
function numberLabel(value:number){const absolute=Math.abs(value);if(absolute>=10_000||(absolute>0&&absolute<.001))return value.toExponential(1);if(absolute>=100)return value.toFixed(0);if(absolute>=1)return value.toFixed(2).replace(/\.00$/,'');return value.toFixed(3).replace(/0+$/,'').replace(/\.$/,'')}

export function Plot({series,color='#45e6a6',locale='en',overlays=[]}:{series?:Series;color?:string;locale?:'es'|'en';overlays?:PlotOverlay[]}) {
  const es=locale==='es'
  const [hoverIndex,setHoverIndex]=useState<number|null>(null),[zoom,setZoom]=useState(1),[pan,setPan]=useState(0),[progress,setProgress]=useState(1),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1)
  const drag=useRef<{x:number;pan:number}|null>(null),animation=useRef<number|null>(null),started=useRef(0)
  const clipId=useRef(`plot-clip-${Math.random().toString(36).slice(2)}`).current
  const key=series?.name??''
  useEffect(()=>{setZoom(1);setPan(0);setProgress(1);setPlaying(false)},[key])
  useEffect(()=>{
    if(!playing)return
    started.current=performance.now()-progress*2400/speed
    const frame=(now:number)=>{const next=Math.min(1,(now-started.current)/(2400/speed));setProgress(next);if(next<1)animation.current=requestAnimationFrame(frame);else setPlaying(false)}
    animation.current=requestAnimationFrame(frame)
    return()=>{if(animation.current!==null)cancelAnimationFrame(animation.current)}
  },[playing,speed])
  if(!series||!series.x.length||!series.y.length)return <div className="plot empty">{es?'Ejecute el experimento para visualizar el resultado.':'Run the experiment to see this result.'}</div>

  const length=Math.min(series.x.length,series.y.length),visibleCount=Math.max(1,Math.ceil(length*progress)),xValues=series.x.slice(0,length),yValues=series.y.slice(0,length)
  const compared=[series,...overlays.map(overlay=>overlay.series)],fullXDomain=extent(compared.flatMap(item=>item.x)),yDomain=extent(compared.flatMap(item=>item.y))
  const fullSpan=fullXDomain[1]-fullXDomain[0],viewSpan=fullSpan/zoom,viewStart=fullXDomain[0]+(fullSpan-viewSpan)*pan,xDomain:[number,number]=[viewStart,viewStart+viewSpan]
  const xs=xValues.map(value=>position(value,xDomain,FRAME.left,FRAME.right)),ys=yValues.map(value=>position(value,yDomain,FRAME.bottom,FRAME.top))
  const points=xs.slice(0,visibleCount).map((x,index)=>`${x},${ys[index]}`).join(' '),zeroY=yDomain[0]<=0&&yDomain[1]>=0?position(0,yDomain,FRAME.bottom,FRAME.top):FRAME.bottom
  const areaPoints=visibleCount?`${xs[0]},${zeroY} ${points} ${xs[visibleCount-1]},${zeroY}`:''
  const activeIndex=hoverIndex!==null&&hoverIndex<visibleCount?hoverIndex:null,selected=activeIndex===null?null:{x:xs[activeIndex],y:ys[activeIndex],xValue:xValues[activeIndex],yValue:yValues[activeIndex]}
  function inspect(event:PointerEvent<SVGSVGElement>){if(drag.current)return;const bounds=event.currentTarget.getBoundingClientRect(),pointerX=((event.clientX-bounds.left)/bounds.width)*620;let nearest=0;for(let index=1;index<visibleCount;index++)if(Math.abs(xs[index]-pointerX)<Math.abs(xs[nearest]-pointerX))nearest=index;setHoverIndex(nearest)}
  function pointerDown(event:PointerEvent<SVGSVGElement>){if(zoom<=1)return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,pan}}
  function pointerMove(event:PointerEvent<SVGSVGElement>){if(!drag.current){inspect(event);return}const width=event.currentTarget.getBoundingClientRect().width;setPan(Math.max(0,Math.min(1,drag.current.pan-(event.clientX-drag.current.x)/width*zoom/(zoom-1))))}
  function wheel(event:WheelEvent<SVGSVGElement>){event.preventDefault();const next=Math.max(1,Math.min(12,zoom*(event.deltaY>0?.85:1.18)));setZoom(next);if(next===1)setPan(0)}
  const replay=()=>{setPlaying(false);setProgress(0);window.setTimeout(()=>setPlaying(true),0)}
  return <div className="plot plot-interactive">
    <div className="plot-controls"><button onClick={()=>{if(progress>=1)replay();else setPlaying(value=>!value)}}>{playing?'Ⅱ':progress>=1?'▶':'▶'} <span>{playing?(es?'Pausa':'Pause'):progress>=1?(es?'Animar':'Animate'):(es?'Continuar':'Resume')}</span></button><button onClick={replay}>↺ <span>{es?'Repetir':'Replay'}</span></button><label>Zoom <input type="range" min="1" max="12" step="1" value={zoom} onChange={event=>{const next=Number(event.target.value);setZoom(next);if(next===1)setPan(0)}}/><b>{zoom}×</b></label>{zoom>1&&<label>{es?'Pan':'Pan'} <input type="range" min="0" max="100" value={pan*100} onChange={event=>setPan(Number(event.target.value)/100)}/></label>}<label>{es?'Velocidad':'Speed'} <select value={speed} onChange={event=>setSpeed(Number(event.target.value))}><option value=".5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label></div>
    <svg viewBox="0 0 620 238" role="img" aria-label={`${series.y_label} by ${series.x_label}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onPointerLeave={()=>{setHoverIndex(null);drag.current=null}} onWheel={wheel} className={zoom>1?'pannable':''}>
      <defs><linearGradient id={`plot-fill-${clipId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".25"/><stop offset="1" stopColor={color} stopOpacity=".015"/></linearGradient><clipPath id={clipId}><rect x={FRAME.left} y={FRAME.top} width={FRAME.right-FRAME.left} height={FRAME.bottom-FRAME.top}/></clipPath></defs>
      {ticks(yDomain).map(value=>{const y=position(value,yDomain,FRAME.bottom,FRAME.top);return <g key={`y-${value}`}><line x1={FRAME.left} y1={y} x2={FRAME.right} y2={y} className="grid"/><text x={FRAME.left-9} y={y+3} textAnchor="end" className="tick-label">{numberLabel(value)}</text></g>})}
      {ticks(xDomain).map(value=>{const x=position(value,xDomain,FRAME.left,FRAME.right);return <g key={`x-${value}`}><line x1={x} y1={FRAME.top} x2={x} y2={FRAME.bottom} className="grid"/><text x={x} y={FRAME.bottom+16} textAnchor="middle" className="tick-label">{numberLabel(value)}</text></g>})}
      {yDomain[0]<0&&yDomain[1]>0&&<line x1={FRAME.left} y1={zeroY} x2={FRAME.right} y2={zeroY} className="zero-line"/>}<line x1={FRAME.left} y1={FRAME.top} x2={FRAME.left} y2={FRAME.bottom} className="axis"/><line x1={FRAME.left} y1={FRAME.bottom} x2={FRAME.right} y2={FRAME.bottom} className="axis"/>
      <g clipPath={`url(#${clipId})`}><polygon points={areaPoints} fill={`url(#plot-fill-${clipId})`}/><polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>{overlays.map((overlay,index)=>{const count=Math.min(overlay.series.x.length,overlay.series.y.length,Math.max(1,Math.ceil(overlay.series.x.length*progress))),overlayPoints=overlay.series.x.slice(0,count).map((value,point)=>`${position(value,xDomain,FRAME.left,FRAME.right)},${position(overlay.series.y[point],yDomain,FRAME.bottom,FRAME.top)}`).join(' ');return <polyline key={`${overlay.label}-${index}`} points={overlayPoints} fill="none" stroke={overlay.color} strokeWidth="1.7" strokeOpacity=".9" strokeDasharray={overlay.dashed?'5 4':undefined}/>})}</g>
      {selected&&selected.x>=FRAME.left&&selected.x<=FRAME.right&&<g className="plot-cursor"><line x1={selected.x} y1={FRAME.top} x2={selected.x} y2={FRAME.bottom}/><circle cx={selected.x} cy={selected.y} r="4" fill={color}/><g transform={`translate(${selected.x>450?selected.x-154:selected.x+10} ${Math.max(24,Math.min(142,selected.y-28))})`}><rect width="144" height="48" rx="2"/><text x="9" y="18">x {numberLabel(selected.xValue)} {series.x_unit}</text><text x="9" y="36">y {numberLabel(selected.yValue)} {series.y_unit}</text></g></g>}
      <text x={(FRAME.left+FRAME.right)/2} y="234" textAnchor="middle" className="axis-title">{series.x_label} ({series.x_unit})</text><text x="13" y={(FRAME.top+FRAME.bottom)/2} textAnchor="middle" transform={`rotate(-90 13 ${(FRAME.top+FRAME.bottom)/2})`} className="axis-title">{series.y_label} ({series.y_unit})</text>
    </svg>
    <div className="plot-progress"><i style={{width:`${progress*100}%`}}/></div>{overlays.length>0&&<div className="plot-legend"><span><i style={{background:color}}/>{series.name}</span>{overlays.map((overlay,index)=><span key={`${overlay.label}-${index}`}><i style={{background:overlay.color}}/>{overlay.label}</span>)}</div>}
  </div>
}
