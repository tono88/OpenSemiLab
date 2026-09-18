export interface ToolIntegration {tool:string;level:'direct'|'orchestrated'|'available';purpose:string;available:boolean}

const LABELS={
  direct:{es:'Conectada',en:'Connected'},
  orchestrated:{es:'Orquestada',en:'Orchestrated'},
  available:{es:'Detectada',en:'Detected'},
}

export default function ToolCoverage({integrations,locale}:{integrations:ToolIntegration[];locale:'es'|'en'}) {
  const es=locale==='es',connected=integrations.filter(item=>item.available&&item.level!=='available').length,installed=integrations.filter(item=>item.available).length
  return <div className="tool-coverage">
    <div className="coverage-summary"><div><span>{es?'COBERTURA IIC-OSIC':'IIC-OSIC COVERAGE'}</span><b>{connected} {es?'integraciones activas':'active integrations'}</b></div><small>{installed}/{integrations.length} {es?'herramientas detectadas en esta ruta de laboratorio':'tools detected in this laboratory path'}</small></div>
    <div className="coverage-grid">{integrations.map(item=><div className={`${item.level} ${item.available?'available':'missing'}`} key={item.tool}><i/><span><b>{item.tool}</b><small>{item.purpose}</small></span><em>{item.available?LABELS[item.level][locale]:(es?'No instalada':'Not installed')}</em></div>)}</div>
    <p>{es?'La imagen contiene además librerías, editores GUI y utilidades especializadas. Se muestran por separado para no confundir “instalada” con “integrada en el flujo web”.':'The image also contains libraries, GUI editors, and specialized utilities. They are separated so “installed” is not confused with “integrated into the web flow”.'}</p>
  </div>
}
