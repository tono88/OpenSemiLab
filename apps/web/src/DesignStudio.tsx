import { useEffect, useMemo, useState } from 'react'
import DigitalWorkbench from './DigitalWorkbench'

interface Template { id: string; title: string; description: string; outputs: string[]; recommended_pdk: string; tags: string[] }
interface Stage { id: string; title: string; purpose: string; tools: string[]; output: string; status: 'ready' | 'adapter_pending' | 'optional' }
interface Plan { project: Record<string, string>; stages: Stage[]; runner: string; runner_available: boolean; notice: string }

const FALLBACK: Template[] = [
  { id:'microcontroller', title:'Microcontroller / SoC', description:'RISC-V controller with memories, buses and peripherals, from RTL to GDSII.', outputs:['verified RTL','timing reports','GDSII'], recommended_pdk:'sky130A', tags:['digital','RISC-V','ASIC'] },
  { id:'sensor_interface', title:'Smart sensor interface', description:'Analog sensing front-end, control logic and communications in one mixed-signal project.', outputs:['schematic','mixed-signal tests','layout'], recommended_pdk:'gf180mcuD', tags:['sensor','analog','mixed-signal'] },
  { id:'analog_block', title:'Analog integrated block', description:'Amplifier, reference, oscillator or data-converter building block.', outputs:['SPICE corners','layout','DRC/LVS/PEX'], recommended_pdk:'sky130A', tags:['analog','SPICE','layout'] },
  { id:'rf_frontend', title:'RF front-end', description:'RF/SiGe blocks connecting circuit, electromagnetic and layout verification.', outputs:['S-parameters','EM model','GDSII'], recommended_pdk:'ihp-sg13g2', tags:['RF','SiGe','EM'] },
  { id:'standard_cell', title:'Standard cell / reusable IP', description:'Create, characterize and package a reusable cell or IP block.', outputs:['Liberty','LEF/GDS','verification deck'], recommended_pdk:'sky130A', tags:['IP','characterization','library'] },
  { id:'fpga_prototype', title:'FPGA prototype', description:'Validate digital architecture on iCE40 or ECP5 before an ASIC flow.', outputs:['bitstream','coverage','waveforms'], recommended_pdk:'sky130A', tags:['FPGA','prototype','digital'] },
]

export default function DesignStudio() {
  const [templates, setTemplates] = useState(FALLBACK)
  const [kind, setKind] = useState('microcontroller')
  const selected = useMemo(() => templates.find(item => item.id === kind) ?? templates[0], [templates, kind])
  const [name, setName] = useState('Open MCU 01')
  const [pdk, setPdk] = useState('sky130A')
  const [level, setLevel] = useState('guided')
  const [language, setLanguage] = useState('systemverilog')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { fetch('/api/v1/design/templates').then(r => r.ok ? r.json() : FALLBACK).then(setTemplates).catch(() => setTemplates(FALLBACK)) }, [])
  useEffect(() => { if (selected) setPdk(selected.recommended_pdk) }, [selected])

  async function buildPlan() {
    setError('')
    try {
      const response = await fetch('/api/v1/design/plan', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name, kind, pdk, level, language }) })
      if (!response.ok) throw new Error('Could not create the design plan.')
      setPlan(await response.json())
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Design service unavailable.') }
  }

  return <main className="design-main">
    <section className="intro design-intro"><div><p className="eyebrow">DESIGN STUDIO / OPEN EDA</p><h1>Build the system.<br/><span>Inspect every stage.</span></h1><p>Choose what you want to create. OpenSemiLab assembles a teachable, reproducible flow from the IIC-OSIC toolchain instead of making you start from a list of applications.</p></div><div className="status-card"><span>EXECUTION BACKEND</span><b>IIC-OSIC-TOOLS</b><p>Digital RTL runner connected · physical and analog adapters in development</p></div></section>
    <section className="design-section"><div className="section-heading"><span>01</span><div><h2>What do you want to build?</h2><p>Each template is a complete engineering path, not a single tool.</p></div></div>
      <div className="template-grid">{templates.map(item => <button key={item.id} className={`template-card ${kind===item.id?'selected':''}`} onClick={()=>{setKind(item.id);setPlan(null)}}><div className="template-top"><span>{item.tags[0]}</span><b>{kind===item.id?'●':'○'}</b></div><h3>{item.title}</h3><p>{item.description}</p><div className="tags">{item.tags.map(tag=><i key={tag}>{tag}</i>)}</div><small>OUTPUT · {item.outputs.join(' · ')}</small></button>)}</div>
    </section>
    <section className="design-config"><div className="section-heading"><span>02</span><div><h2>Configure the project</h2><p>The guided view explains decisions; expert mode exposes manifests and native controls.</p></div></div>
      <div className="config-panel"><label>Project name<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Process / PDK<select value={pdk} onChange={e=>setPdk(e.target.value)}><option value="sky130A">SkyWater SKY130</option><option value="gf180mcuD">GlobalFoundries GF180MCU</option><option value="ihp-sg13g2">IHP SG13G2 SiGe BiCMOS</option><option value="ihp-sg13cmos5l">IHP SG13CMOS5L</option></select></label><label>Learning depth<select value={level} onChange={e=>setLevel(e.target.value)}><option value="guided">Guided</option><option value="engineering">Engineering</option><option value="expert">Expert / native parameters</option></select></label><label>Primary entry<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="systemverilog">SystemVerilog</option><option value="verilog">Verilog</option><option value="vhdl">VHDL</option><option value="schematic">Schematic</option></select></label><button className="run" onClick={buildPlan}>Create design flow <span>→</span></button></div>{error&&<p className="error">{error}</p>}
    </section>
    {plan && <><section className="flow-result"><div className="section-heading"><span>03</span><div><h2>{name}: engineering flow</h2><p>{kind==='microcontroller'||kind==='fpga_prototype'?'RTL lint, simulation and synthesis are connected below. Physical design adapters remain pending.':plan.notice}</p></div></div><div className="flow-line">{plan.stages.map((item,index)=><article className="flow-stage" key={item.id}><div className="stage-index">{String(index+1).padStart(2,'0')}</div><div><span>{item.status==='ready'?'SPECIFICATION':'IIC-OSIC ADAPTER'}</span><h3>{item.title}</h3><p>{item.purpose}</p><div className="tool-list">{item.tools.map(tool=><i key={tool}>{tool}</i>)}</div><small>DELIVERS · {item.output}</small></div></article>)}</div><div className="runner-note"><div><span>RUNNER</span><b>{plan.runner}</b></div><strong className={kind==='microcontroller'||kind==='fpga_prototype'?'connected':''}>{kind==='microcontroller'||kind==='fpga_prototype'?'PARTIAL · EXECUTABLE':'PLANNED'}</strong></div>{level==='expert'&&<pre>{JSON.stringify({schema:'opensemilab.design/v1',project:{name,kind,pdk,level,language},stages:plan.stages.map(s=>s.id)},null,2)}</pre>}</section>{(kind==='microcontroller'||kind==='fpga_prototype')&&<DigitalWorkbench/>}</>}
  </main>
}
