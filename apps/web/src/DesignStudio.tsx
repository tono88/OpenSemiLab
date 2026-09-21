import { useEffect, useMemo, useState } from 'react'
import ProjectWorkspace from './ProjectWorkspace'
import { createProject, loadProjects, saveProjects, type StoredProject } from './projectStore'

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
  { id:'blank_project', title:'Blank structured project', description:'Start from an organized engineering workspace without example circuitry.', outputs:['project manifest','stage folders','reproducible structure'], recommended_pdk:'sky130A', tags:['blank','structure','custom'] },
]

const TEMPLATE_ES: Record<string, Pick<Template,'title'|'description'|'outputs'>> = {
  microcontroller:{title:'Microcontrolador / SoC',description:'Controlador basado en RISC-V con memoria, buses y periféricos, desde RTL hasta GDSII.',outputs:['RTL verificado','reportes de temporización','GDSII']},
  sensor_interface:{title:'Interfaz de sensor inteligente',description:'Frente analógico, lógica de control y comunicaciones digitales en un proyecto de señal mixta.',outputs:['esquemático','pruebas de señal mixta','layout']},
  analog_block:{title:'Bloque integrado analógico',description:'Diseñe y caracterice un amplificador, referencia, oscilador o bloque de conversión de datos.',outputs:['esquinas SPICE','layout','DRC/LVS/PEX']},
  rf_frontend:{title:'Frente de radiofrecuencia',description:'Cree bloques RF/SiGe y conecte la verificación de circuito, electromagnética y de layout.',outputs:['parámetros S','modelo EM','GDSII']},
  standard_cell:{title:'Celda estándar / IP reutilizable',description:'Cree, verifique, caracterice y empaquete una celda o bloque IP reutilizable.',outputs:['Liberty','LEF/GDS','reglas de verificación']},
  fpga_prototype:{title:'Prototipo FPGA',description:'Valide la arquitectura digital en iCE40 o ECP5 antes de comprometer un flujo ASIC.',outputs:['bitstream','cobertura','formas de onda']},
  blank_project:{title:'Proyecto en blanco estructurado',description:'Comience sin circuitos de ejemplo, pero con el manifiesto y las carpetas de cada etapa ya organizadas.',outputs:['manifiesto','carpetas del flujo','estructura reproducible']},
}

export default function DesignStudio({ locale }: { locale: 'es' | 'en' }) {
  const es=locale==='es'
  const [templates, setTemplates] = useState(FALLBACK)
  const [kind, setKind] = useState('microcontroller')
  const selected = useMemo(() => templates.find(item => item.id === kind) ?? templates[0], [templates, kind])
  const [name, setName] = useState('Open MCU 01')
  const [pdk, setPdk] = useState('sky130A')
  const [level, setLevel] = useState('guided')
  const [language, setLanguage] = useState('systemverilog')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [githubUrl,setGithubUrl]=useState('')
  const [importingGithub,setImportingGithub]=useState(false)
  const [projects,setProjects]=useState<StoredProject[]>(()=>loadProjects())
  const [activeProjectId,setActiveProjectId]=useState<string|null>(null)
  const activeProject=projects.find(project=>project.id===activeProjectId)??null

  useEffect(() => { fetch('/api/v1/design/templates').then(r => r.ok ? r.json() : FALLBACK).then(setTemplates).catch(() => setTemplates(FALLBACK)) }, [])
  useEffect(() => { if (selected) setPdk(selected.recommended_pdk) }, [selected])

  async function buildPlan() {
    setError('')
    try {
      const response = await fetch('/api/v1/design/plan', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name, kind, pdk, level, language }) })
      if (!response.ok) throw new Error(es?'No se pudo crear el flujo de diseño.':'Could not create the design plan.')
      setPlan(await response.json())
      const project=createProject({name,kind,pdk,level,language})
      const next=[project,...projects]
      setProjects(next);saveProjects(next);setActiveProjectId(project.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : (es?'Servicio de diseño no disponible.':'Design service unavailable.')) }
  }

  function updateProject(updated:StoredProject) {
    const next=projects.map(project=>project.id===updated.id?updated:project)
    setProjects(next);saveProjects(next)
  }

  function openProject(project:StoredProject) {
    setActiveProjectId(project.id);setName(project.name);setKind(project.kind);setPdk(project.pdk);setLevel(project.level);setLanguage(project.language);setPlan(null)
  }

  function deleteProject(id:string) {
    if(!window.confirm(es?'¿Eliminar este proyecto local?':'Delete this local project?')) return
    const next=projects.filter(project=>project.id!==id);setProjects(next);saveProjects(next);if(activeProjectId===id)setActiveProjectId(null)
  }

  function acceptImportedProject(imported:StoredProject) {
    if(!imported.name||!imported.kind||!Array.isArray(imported.files)) throw new Error()
    imported.id=projects.some(project=>project.id===imported.id)?crypto.randomUUID():(imported.id||crypto.randomUUID())
    imported.updatedAt=new Date().toISOString()
    const next=[imported,...projects];setProjects(next);saveProjects(next);openProject(imported)
  }

  async function importProject(file:File) {
    try {
      const imported=JSON.parse(await file.text()) as StoredProject
      acceptImportedProject(imported)
    } catch {setError(es?'El archivo no es un proyecto OpenSemiLab válido.':'The file is not a valid OpenSemiLab project.')}
  }

  async function importGithub() {
    setError('');setImportingGithub(true)
    try {
      const response=await fetch('/api/v1/design/import-github',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:githubUrl.trim()})})
      const imported=await response.json()
      if(!response.ok)throw new Error(imported.detail??(es?'No se pudo importar el repositorio.':'Could not import the repository.'))
      acceptImportedProject(imported as StoredProject)
    } catch(reason) {setError(reason instanceof Error?reason.message:(es?'No se pudo importar el repositorio.':'Could not import the repository.'))}
    finally {setImportingGithub(false)}
  }

  if(activeProject) return <main className="design-main workspace-active"><ProjectWorkspace project={activeProject} locale={locale} onChange={updateProject} onClose={()=>setActiveProjectId(null)}/></main>

  return <main className="design-main">
    <section className="intro design-intro"><div><p className="eyebrow">{es?'ESTUDIO DE DISEÑO / EDA ABIERTO':'DESIGN STUDIO / OPEN EDA'}</p><h1>{es?'Construya el sistema.':'Build the system.'}<br/><span>{es?'Inspeccione cada etapa.':'Inspect every stage.'}</span></h1><p>{es?'Elija qué desea crear. OpenSemiLab ensambla un flujo reproducible y fácil de enseñar sobre IIC-OSIC, sin obligarle a comenzar desde una lista de aplicaciones.':'Choose what you want to create. OpenSemiLab assembles a teachable, reproducible flow from the IIC-OSIC toolchain instead of making you start from a list of applications.'}</p></div><div className="status-card"><span>{es?'MOTOR DE EJECUCIÓN':'EXECUTION BACKEND'}</span><b>IIC-OSIC-TOOLS</b><p>{es?'RTL, SPICE y RTL→GDSII conectados para SKY130/GF180':'RTL, SPICE and RTL→GDSII connected for SKY130/GF180'}</p></div></section>
    <section className="project-library"><div className="section-heading"><span>00</span><div><h2>{es?'Mis proyectos':'My projects'}</h2><p>{es?'Abra diseños anteriores o importe un JSON de OpenSemiLab o un repositorio público de GitHub.':'Open earlier designs or import an OpenSemiLab JSON or a public GitHub repository.'}</p></div></div><div className="library-actions"><label>{es?'Importar JSON':'Import JSON'}<input type="file" accept=".json,.opensemilab.json" onChange={event=>{const file=event.target.files?.[0];if(file)void importProject(file);event.target.value='' }}/></label><div className="github-import"><input aria-label={es?'URL pública de GitHub':'Public GitHub URL'} placeholder="https://github.com/owner/project" value={githubUrl} onChange={event=>setGithubUrl(event.target.value)}/><button disabled={importingGithub||!githubUrl.trim()} onClick={()=>void importGithub()}>{importingGithub?(es?'Importando…':'Importing…'):(es?'Importar GitHub':'Import GitHub')}</button></div></div>{projects.length?<div className="project-library-list">{projects.map(project=><article className="saved-project" key={project.id}><button className="saved-open" onClick={()=>openProject(project)}><b>{project.name}</b><span>{project.kind} · {project.pdk}</span><small>{new Date(project.updatedAt).toLocaleString(locale)}</small></button><button className="saved-delete" onClick={()=>deleteProject(project.id)} title={es?'Eliminar':'Delete'}>×</button></article>)}</div>:<p className="empty-projects">{es?'Todavía no hay proyectos. Elija una plantilla y cree el primero.':'There are no projects yet. Choose a template and create the first one.'}</p>}</section>
    <section className="design-section"><div className="section-heading"><span>01</span><div><h2>{es?'¿Qué desea construir?':'What do you want to build?'}</h2><p>{es?'Cada plantilla representa una ruta completa de ingeniería, no una sola herramienta.':'Each template is a complete engineering path, not a single tool.'}</p></div></div>
      <div className="template-grid">{templates.map(item => {const shown=es?(TEMPLATE_ES[item.id]??item):item;return <button key={item.id} className={`template-card ${kind===item.id?'selected':''}`} onClick={()=>{setKind(item.id);setPlan(null)}}><div className="template-top"><span>{item.tags[0]}</span><b>{kind===item.id?'●':'○'}</b></div><h3>{shown.title}</h3><p>{shown.description}</p><div className="tags">{item.tags.map(tag=><i key={tag}>{tag}</i>)}</div><small>{es?'RESULTADO':'OUTPUT'} · {shown.outputs.join(' · ')}</small></button>})}</div>
    </section>
    <section className="design-config"><div className="section-heading"><span>02</span><div><h2>{es?'Configure el proyecto':'Configure the project'}</h2><p>{es?'La vista guiada explica las decisiones; el modo experto expone manifiestos y controles nativos.':'The guided view explains decisions; expert mode exposes manifests and native controls.'}</p></div></div>
      <div className="config-panel"><label>{es?'Nombre del proyecto':'Project name'}<input value={name} onChange={e=>setName(e.target.value)}/></label><label>{es?'Proceso / PDK':'Process / PDK'}<select value={pdk} onChange={e=>setPdk(e.target.value)}><option value="sky130A">SkyWater SKY130</option><option value="gf180mcuD">GlobalFoundries GF180MCU</option><option value="ihp-sg13g2">IHP SG13G2 SiGe BiCMOS</option><option value="ihp-sg13cmos5l">IHP SG13CMOS5L</option></select></label><label>{es?'Nivel de aprendizaje':'Learning depth'}<select value={level} onChange={e=>setLevel(e.target.value)}><option value="guided">{es?'Guiado':'Guided'}</option><option value="engineering">{es?'Ingeniería':'Engineering'}</option><option value="expert">{es?'Experto / parámetros nativos':'Expert / native parameters'}</option></select></label><label>{es?'Entrada principal':'Primary entry'}<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="systemverilog">SystemVerilog</option><option value="verilog">Verilog</option><option value="vhdl">VHDL</option><option value="schematic">{es?'Esquemático':'Schematic'}</option></select></label><button className="run" onClick={buildPlan}>{es?'Crear flujo de diseño':'Create design flow'} <span>→</span></button></div>{error&&<p className="error">{error}</p>}
    </section>
    {plan && <section className="flow-result"><div className="section-heading"><span>03</span><div><h2>{name}: {es?'flujo de ingeniería':'engineering flow'}</h2><p>{plan.notice}</p></div></div><div className="flow-line">{plan.stages.map((item,index)=><article className="flow-stage" key={item.id}><div className="stage-index">{String(index+1).padStart(2,'0')}</div><div><span>{item.status==='ready'?(es?'LISTO':'READY'):'IIC-OSIC ADAPTER'}</span><h3>{item.title}</h3><p>{item.purpose}</p><div className="tool-list">{item.tools.map(tool=><i key={tool}>{tool}</i>)}</div><small>{es?'ENTREGA':'DELIVERS'} · {item.output}</small></div></article>)}</div><div className="runner-note"><div><span>RUNNER</span><b>{plan.runner}</b></div><strong className={plan.runner_available?'connected':''}>{plan.runner_available?(es?'EJECUCIÓN · CONECTADA':'EXECUTION · CONNECTED'):(es?'ARCHIVOS · CREADOS':'FILES · CREATED')}</strong></div>{level==='expert'&&<pre>{JSON.stringify({schema:'opensemilab.design/v1',project:{name,kind,pdk,level,language},stages:plan.stages.map(s=>s.id)},null,2)}</pre>}</section>}
  </main>
}
