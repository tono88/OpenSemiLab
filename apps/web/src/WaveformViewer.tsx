import { useMemo, useState } from 'react'

interface Change {time:number;value:string}
interface Signal {id:string;name:string;width:number;changes:Change[]}
interface VcdData {timescale:string;signals:Signal[];endTime:number}

function parseVcd(content:string):VcdData {
  const signals:Signal[]=[]
  const byId=new Map<string,Signal>()
  const scopes:string[]=[]
  let timescale='',time=0,endTime=0,inDefinitions=true,expectTimescale=false
  for(const rawLine of content.split(/\r?\n/)) {
    const line=rawLine.trim()
    if(!line) continue
    if(inDefinitions) {
      if(expectTimescale&&line!=='$end') {timescale=line.replace('$end','').trim();expectTimescale=false}
      else if(line==='$timescale') expectTimescale=true
      else if(line.startsWith('$timescale')) timescale=line.replace('$timescale','').replace('$end','').trim()
      else if(line.startsWith('$scope')) {const parts=line.split(/\s+/);scopes.push(parts[2]??'scope')}
      else if(line.startsWith('$upscope')) scopes.pop()
      else if(line.startsWith('$var')) {
        const parts=line.split(/\s+/);const width=Number(parts[2]??1);const id=parts[3];const reference=parts.slice(4,-1).join(' ')
        if(id&&reference) {const signal={id,name:[...scopes,reference].join('.'),width,changes:[]};signals.push(signal);byId.set(id,signal)}
      } else if(line.startsWith('$enddefinitions')) inDefinitions=false
      continue
    }
    if(line.startsWith('#')) {time=Number(line.slice(1));endTime=Math.max(endTime,time);continue}
    const scalar=line.match(/^([01xXzZ])(.+)$/)
    const vector=line.match(/^[bB]([01xXzZ]+)\s+(.+)$/)
    const id=scalar?.[2]??vector?.[2];const value=scalar?.[1]??vector?.[1]
    const signal=id?byId.get(id):undefined
    if(signal&&value!==undefined) signal.changes.push({time,value:value.toLowerCase()})
  }
  return {timescale,signals:signals.filter(signal=>signal.changes.length),endTime:endTime||1}
}

function scalarPath(signal:Signal,start:number,end:number,left:number,width:number,y:number) {
  const changes=signal.changes.filter(change=>change.time>=start&&change.time<=end)
  const prior=[...signal.changes].reverse().find(change=>change.time<=start)
  if(prior&&!changes.some(change=>change.time===prior.time)) changes.unshift({time:start,value:prior.value})
  if(!changes.length) return ''
  const x=(time:number)=>left+((Math.max(start,Math.min(end,time))-start)/(end-start||1))*width
  const level=(value:string)=>value==='1'?y-10:value==='0'?y+10:y
  let path=`M ${x(start)} ${level(changes[0].value)}`
  for(let index=1;index<changes.length;index+=1) {const change=changes[index];path+=` H ${x(change.time)} V ${level(change.value)}`}
  return `${path} H ${x(end)}`
}

export default function WaveformViewer({content,locale}:{content:string;locale:'es'|'en'}) {
  const es=locale==='es'
  const data=useMemo(()=>parseVcd(content),[content])
  const [chosen,setChosen]=useState<string[]>([])
  const [zoom,setZoom]=useState(1)
  const [pan,setPan]=useState(0)
  const validChosen=chosen.filter(id=>data.signals.some(signal=>signal.id===id))
  const selected=(validChosen.length?validChosen:data.signals.slice(0,8).map(signal=>signal.id)).map(id=>data.signals.find(signal=>signal.id===id)!).filter(Boolean)
  const span=data.endTime/zoom,start=(data.endTime-span)*(pan/100),end=start+span
  const left=190,width=780,rowHeight=42,height=Math.max(145,72+selected.length*rowHeight)
  const x=(time:number)=>left+((time-start)/(end-start||1))*width

  function toggle(id:string) {
    const baseline=validChosen.length?validChosen:data.signals.slice(0,8).map(signal=>signal.id)
    setChosen(baseline.includes(id)?baseline.filter(item=>item!==id):baseline.length<12?[...baseline,id]:baseline)
  }

  return <section className="analysis-view waveform-viewer">
    <div className="analysis-title"><div><span>RTL / VCD</span><b>{es?'Formas de onda digitales':'Digital waveforms'}</b></div><small>{data.signals.length} {es?'señales':'signals'} · {data.timescale||'timescale n/a'}</small></div>
    <div className="wave-controls"><label>{es?'Zoom':'Zoom'}<input type="range" min="1" max="10" step="1" value={zoom} onChange={event=>{setZoom(Number(event.target.value));setPan(0)}}/><b>{zoom}×</b></label>{zoom>1&&<label>{es?'Ventana':'Window'}<input type="range" min="0" max="100" value={pan} onChange={event=>setPan(Number(event.target.value))}/></label>}</div>
    <div className="wave-layout"><aside>{data.signals.slice(0,40).map(signal=><button className={selected.some(item=>item.id===signal.id)?'active':''} onClick={()=>toggle(signal.id)} key={signal.id}><i/>{signal.name}</button>)}</aside><div className="wave-canvas"><svg viewBox={`0 0 1000 ${height}`} role="img" aria-label={es?'Formas de onda VCD':'VCD waveforms'}>
      {[0,.25,.5,.75,1].map(fraction=>{const time=start+(end-start)*fraction;return <g key={fraction}><line x1={left+width*fraction} y1="30" x2={left+width*fraction} y2={height-14} className="wave-grid"/><text x={left+width*fraction} y="18" textAnchor="middle">{time.toFixed(time<10?2:0)}</text></g>})}
      {selected.map((signal,index)=>{const y=52+index*rowHeight;return <g key={signal.id}><text x="8" y={y+4} className="wave-name">{signal.name}</text><line x1={left} y1={y} x2={left+width} y2={y} className="wave-mid"/>{signal.width===1?<path d={scalarPath(signal,start,end,left,width,y)} className="wave-trace"/>:<BusTrace signal={signal} start={start} end={end} x={x} y={y}/>}</g>})}
    </svg></div></div>
  </section>
}

function BusTrace({signal,start,end,x,y}:{signal:Signal;start:number;end:number;x:(time:number)=>number;y:number}) {
  const changes=signal.changes.filter(change=>change.time>=start&&change.time<=end)
  const prior=[...signal.changes].reverse().find(change=>change.time<=start)
  if(prior&&!changes.some(change=>change.time===prior.time)) changes.unshift({time:start,value:prior.value})
  return <g>{changes.map((change,index)=>{const from=Math.max(start,change.time),to=Math.min(end,changes[index+1]?.time??end);if(to<start||from>end)return null;return <g key={`${change.time}-${index}`}><rect x={x(from)} y={y-10} width={Math.max(1,x(to)-x(from))} height="20" className="bus-segment"/><text x={(x(from)+x(to))/2} y={y+3} textAnchor="middle" className="bus-value">{change.value.length>12?`${change.value.slice(0,10)}…`:change.value}</text></g>})}</g>
}
