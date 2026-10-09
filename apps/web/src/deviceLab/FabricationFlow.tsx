import { useState } from 'react'
import { text as t, type DeviceId, type Locale } from './types'

const stages = [
  { title: t('Cristal y oblea', 'Crystal and wafer'), body: t('Se crece un cristal, se corta en obleas y se pule. Orientación, defectos y contaminación condicionan todo el proceso.', 'A crystal is grown, sliced into wafers and polished. Orientation, defects and contamination affect the whole process.'), link: 'material' },
  { title: t('Limpieza y pozos', 'Cleaning and wells'), body: t('Las limpiezas preparan la superficie. El dopaje define sustratos y pozos; cada implantación necesita una máscara y activación.', 'Cleaning prepares the surface. Doping defines substrates and wells; each implant needs a mask and activation.'), link: 'implantation' },
  { title: t('Aislamiento', 'Isolation'), body: t('Regiones aislantes separan los dispositivos. El dibujo muestra una sección conceptual, no una receta de STI.', 'Insulating regions separate devices. The drawing is a conceptual cross-section, not an STI recipe.'), link: 'oxidation' },
  { title: t('Óxido y película de puerta', 'Gate oxide and film'), body: t('Un dieléctrico separa la puerta del canal. El espesor modifica la capacitancia y el control electrostático.', 'A dielectric separates the gate from the channel. Thickness changes capacitance and electrostatic control.'), link: 'moscap' },
  { title: t('Resist y exposición', 'Resist and exposure'), body: t('Se deposita resist y una máscara selecciona dónde llega la luz. Longitud de onda, NA, dosis y foco definen la ventana de proceso.', 'Resist is deposited and a mask selects where light arrives. Wavelength, NA, dose and focus define the process window.'), link: 'lithography' },
  { title: t('Revelado y grabado', 'Development and etch'), body: t('El patrón revelado permite eliminar material en regiones elegidas. La selectividad y anisotropía afectan la geometría final.', 'Developed patterns allow material removal in selected regions. Selectivity and anisotropy affect final geometry.'), link: 'etching' },
  { title: t('Fuente y drenador', 'Source and drain'), body: t('La implantación crea fuente y drenador; la puerta puede actuar como referencia de autoalineación. La dosis no equivale a dopaje activado.', 'Implantation creates source and drain; the gate can provide a self-alignment reference. Dose is not activated doping.'), link: 'implantation' },
  { title: t('Recocido y activación', 'Annealing and activation'), body: t('El recocido reduce daños y activa dopantes, pero también puede redistribuirlos. El laboratorio calcula ensanchamiento, no activación.', 'Annealing reduces damage and activates dopants but can redistribute them. The laboratory calculates broadening, not activation.'), link: 'diffusion' },
  { title: t('Dieléctrico entre capas', 'Interlayer dielectric'), body: t('Se depositan aislantes para separar conexiones. Uniformidad y cobertura de escalones son importantes.', 'Insulators separate interconnect layers. Uniformity and step coverage matter.'), link: 'deposition' },
  { title: t('Vías y metalización', 'Vias and metallization'), body: t('Se abren contactos y se conectan los terminales. Resistencias, electromigración y reglas de diseño requieren modelos de proceso.', 'Contacts are opened and terminals connected. Resistance, electromigration and design rules require process models.'), link: 'deposition' },
  { title: t('Planarización y pasivación', 'Planarization and passivation'), body: t('La planarización prepara capas siguientes y la pasivación protege el chip. Se miden espesores y defectos a lo largo del flujo.', 'Planarization prepares later layers and passivation protects the chip. Thickness and defects are measured throughout the flow.'), link: 'yield' },
  { title: t('Prueba, corte y encapsulado', 'Test, dicing and packaging'), body: t('Se prueban los chips, se corta la oblea y se encapsula. Rendimiento eléctrico, térmico y mecánico deben verificarse con mediciones.', 'Dies are tested, the wafer is diced and chips packaged. Electrical, thermal and mechanical behavior must be verified by measurement.'), link: 'yield' },
] as const

export default function FabricationFlow({ locale, onDevice }: { locale: Locale; onDevice: (device: DeviceId) => void }) {
  const es = locale === 'es', [step, setStep] = useState(0), stage = stages[step]
  return <section className="dl-fabrication" aria-label={es ? 'Recorrido de fabricación' : 'Fabrication walkthrough'}>
    <div className="dl-section-title"><div><span>{es ? 'DEL MATERIAL AL CHIP' : 'FROM MATERIAL TO CHIP'}</span><h3>{es ? 'Recorrido de fabricación' : 'Fabrication walkthrough'}</h3></div><small>{step + 1} / {stages.length}</small></div>
    <div className="dl-process-layout"><div className="dl-process-steps">{stages.map((item, index) => <button key={item.title.en} aria-pressed={step === index} onClick={() => setStep(index)}><span>{String(index + 1).padStart(2, '0')}</span>{item.title[locale]}</button>)}</div><div>
      <svg viewBox="0 0 680 300" role="img" aria-label={es ? `Sección conceptual: ${stage.title.es}` : `Conceptual cross-section: ${stage.title.en}`}>
        <rect x="36" y="156" width="608" height="98" fill="#432a40"/><text x="340" y="239">{es ? 'Sustrato de silicio' : 'Silicon substrate'}</text>
        {step >= 1 && <rect x="464" y="183" width="145" height="40" fill="#1e5260"/>}
        {step >= 2 && <>{[54, 590].map(x => <rect key={x} x={x} y="143" width="40" height="72" fill="#919777"/>)}</>}
        {step >= 3 && <><rect x="110" y="150" width="460" height="7" fill="#e1c97c"/><rect x={step >= 5 ? 272 : 110} y="115" width={step >= 5 ? 136 : 460} height="35" fill="#506d80"/></>}
        {step === 4 && <><rect x="110" y="96" width="460" height="18" fill="#a45891"/><rect x="110" y="48" width="162" height="12" fill="#91a2a9"/><rect x="408" y="48" width="162" height="12" fill="#91a2a9"/>{[294, 319, 344, 369, 394].map(x => <path key={x} d={`M${x} 22 V92 l-5 -8 m5 8 l5 -8`} stroke="#e8d07d" strokeWidth="2" fill="none"/>)}</>}
        {step >= 6 && <><rect x="110" y="157" width="142" height="27" fill="#48b6d9"/><rect x="428" y="157" width="142" height="27" fill="#48b6d9"/><text x="180" y="179">S</text><text x="500" y="179">D</text></>}
        {step === 7 && <path d="M80 100 Q120 78 160 100 T240 100 T320 100 T400 100 T480 100 T560 100 T640 100" fill="none" stroke="#efad6b" strokeWidth="3"/>}
        {step >= 8 && <path d="M100 79 H580 V151 H425 V113 H412 V78 H268 V113 H255 V151 H100 Z" fill="#859d8e" opacity=".48"/>}
        {step >= 9 && <><path d="M182 60 V156 M340 60 V114 M500 60 V156" stroke="#daaf72" strokeWidth="16"/><path d="M140 56 H222 M298 56 H382 M458 56 H542" stroke="#ebc992" strokeWidth="13"/></>}
        {step >= 10 && <rect x="88" y="36" width="504" height="10" fill="#b6d0b7" opacity=".7"/>}
        {step === 11 && <><rect x="18" y="16" width="644" height="266" fill="none" stroke="#526d69" strokeWidth="9"/>{[65, 135, 205, 475, 545, 615].map(x => <path key={x} d={`M${x} 282 V298`} stroke="#b6c7c5" strokeWidth="11"/>)}</>}
      </svg>
      <h4>{stage.title[locale]}</h4><p>{stage.body[locale]}</p><button onClick={() => onDevice(stage.link)}>{es ? 'Abrir experimento relacionado' : 'Open related experiment'} →</button>
      <p className="dl-caption">{es ? 'Secuencia didáctica de un transistor planar. Cada proceso real incluye pasos, materiales, máscaras y verificaciones adicionales; los dibujos no están a escala.' : 'Educational sequence for a planar transistor. Real processes include additional steps, materials, masks and checks; drawings are not to scale.'}</p>
    </div></div>
  </section>
}
