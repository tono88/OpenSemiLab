export interface DefComponent { name:string; x:number; y:number }
export interface DefRouteSegment { layer:string; x1:number; y1:number; x2:number; y2:number }
export interface DefLayer { name:string; color:string; segments:DefRouteSegment[]; lengthUm:number }
export interface DefLayout { width:number; height:number; components:DefComponent[]; layers:DefLayer[] }

const LAYER_COLORS=['#58d6ff','#ffcb6b','#ff7597','#b89cff','#72e7a9','#ff995e','#71a7ff','#e2ef65','#ef7dff','#60e3db']

function layerRank(name:string) {
  const lower=name.toLowerCase(),number=Number(lower.match(/\d+/)?.[0]??0)
  if(lower.includes('li')) return number-.5
  if(lower.includes('met')||lower.includes('metal')) return number
  return 100+number
}

function routeBlocks(content:string) {
  return [...content.matchAll(/(?:^|\n)\s*(?:SPECIALNETS|NETS)\s+\d+\s*;([\s\S]*?)END\s+(?:SPECIALNETS|NETS)/gi)].map(match=>match[1])
}

export function parseDefLayout(content:string):DefLayout|null {
  const units=Number(content.match(/UNITS\s+DISTANCE\s+MICRONS\s+(\d+)/i)?.[1]??1000)
  const die=content.match(/DIEAREA\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)/i)
  if(!die||!Number.isFinite(units)||units<=0) return null
  const x0=Number(die[1]),y0=Number(die[2]),x1=Number(die[3]),y1=Number(die[4])
  const components:DefComponent[]=[]
  const componentBlock=content.match(/COMPONENTS\s+\d+\s*;([\s\S]*?)END COMPONENTS/i)?.[1]??''
  for(const entry of componentBlock.split(';')) {
    const match=entry.match(/-\s+(\S+)\s+\S+[\s\S]*?\+\s+(?:PLACED|FIXED)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)/i)
    if(match) components.push({name:match[1],x:(Number(match[2])-x0)/units,y:(Number(match[3])-y0)/units})
    if(components.length>=6000) break
  }
  const byLayer=new Map<string,DefRouteSegment[]>();let totalSegments=0
  for(const block of routeBlocks(content)) for(const net of block.split(';')) {
    const clauses=[...net.matchAll(/(?:\+\s*)?(?:ROUTED|NEW)\s+(\S+)([\s\S]*?)(?=(?:\+\s*)?(?:ROUTED|NEW)\s+\S+|$)/gi)]
    for(const clause of clauses) {
      const layer=clause[1],points=[...clause[2].matchAll(/\(\s*(-?\d+|\*)\s+(-?\d+|\*)\s*\)/g)]
      let previous:{x:number;y:number}|null=null
      for(const point of points) {
        const rawX:number|undefined=point[1]==='*'?previous?.x:Number(point[1])
        const rawY:number|undefined=point[2]==='*'?previous?.y:Number(point[2])
        if(rawX===undefined||rawY===undefined||!Number.isFinite(rawX)||!Number.isFinite(rawY)) continue
        const current:{x:number;y:number}={x:rawX,y:rawY}
        if(previous&&(previous.x!==rawX||previous.y!==rawY)) {
          const segments=byLayer.get(layer)??[]
          if(segments.length<4000&&totalSegments<16000) {segments.push({layer,x1:(previous.x-x0)/units,y1:(previous.y-y0)/units,x2:(rawX-x0)/units,y2:(rawY-y0)/units});byLayer.set(layer,segments);totalSegments++}
        }
        previous=current
      }
    }
  }
  const layers=[...byLayer.entries()].sort(([a],[b])=>layerRank(a)-layerRank(b)||a.localeCompare(b)).map(([name,segments],index)=>({name,color:LAYER_COLORS[index%LAYER_COLORS.length],segments,lengthUm:segments.reduce((sum,s)=>sum+Math.abs(s.x2-s.x1)+Math.abs(s.y2-s.y1),0)}))
  return {width:(x1-x0)/units,height:(y1-y0)/units,components,layers}
}

export function densityBins(layout:DefLayout,size=12) {
  const bins=Array.from({length:size},()=>Array<number>(size).fill(0))
  for(const component of layout.components) {
    const x=Math.min(size-1,Math.max(0,Math.floor(component.x/layout.width*size))),y=Math.min(size-1,Math.max(0,Math.floor(component.y/layout.height*size)))
    bins[y][x]++
  }
  return bins
}
