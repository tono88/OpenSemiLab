import { lazy, Suspense, useState } from 'react'
import DesignStudio from './DesignStudio'
import type { Mode } from './types'

const DeviceLaboratory = lazy(() => import('./deviceLab/DeviceLaboratory'))
const MODES: Mode[] = ['Explore', 'Learn', 'Design', 'Advanced', 'Research']

export default function App() {
  const [locale, setLocale] = useState<'es' | 'en'>(() => localStorage.getItem('opensemilab.locale') === 'en' ? 'en' : 'es')
  const [area, setArea] = useState<'design' | 'lab'>('design')
  const [mode, setMode] = useState<Mode>('Explore')
  const es = locale === 'es'
  const labels: Record<Mode, string> = es
    ? { Explore: 'Explorar', Learn: 'Aprender', Design: 'Diseñar', Advanced: 'Avanzado', Research: 'Investigación' }
    : { Explore: 'Explore', Learn: 'Learn', Design: 'Design', Advanced: 'Advanced', Research: 'Research' }
  function changeLocale(next: 'es' | 'en') { setLocale(next); localStorage.setItem('opensemilab.locale', next) }

  return <div className="app-shell">
    <header><div className="brand"><div className="mark">OS</div><div><strong>OpenSemiLab</strong><small>{es ? 'Laboratorio de semiconductores' : 'Semiconductor laboratory'}</small></div></div><nav className="primary-nav" aria-label={es ? 'Navegación principal' : 'Main navigation'}><button className={area === 'design' ? 'active' : ''} onClick={() => setArea('design')}>{es ? 'Estudio de diseño' : 'Design Studio'}</button><button className={area === 'lab' ? 'active' : ''} onClick={() => setArea('lab')}>{es ? 'Laboratorio de dispositivos' : 'Device Lab'}</button><button onClick={() => { location.hash = '#/equipo' }}>{es ? 'Equipo' : 'Team'}</button></nav><div className="header-tools"><div className="locale-switch" aria-label={es ? 'Idioma' : 'Language'}><button className={locale === 'es' ? 'active' : ''} onClick={() => changeLocale('es')}>ES</button><button className={locale === 'en' ? 'active' : ''} onClick={() => changeLocale('en')}>EN</button></div><div className="engine"><i/> {es ? 'Entorno local' : 'Local workspace'} <span>v0.3</span></div></div></header>
    {area === 'lab' ? <><nav className="modes" aria-label={es ? 'Profundidad del laboratorio' : 'Laboratory depth'}>{MODES.map((item, i) => <button className={mode === item ? 'active' : ''} aria-label={labels[item]} aria-pressed={mode === item} onClick={() => setMode(item)} key={item}><em>0{i + 1}</em>{labels[item]}</button>)}</nav><Suspense fallback={<main aria-busy="true"><p>{es ? 'Cargando laboratorio…' : 'Loading laboratory…'}</p></main>}><DeviceLaboratory locale={locale} mode={mode}/></Suspense></> : <DesignStudio locale={locale}/>}
    <footer><span>{es ? 'DEL RTL AL SILICIO · FLUJOS EDA ABIERTOS · DISEÑO VERIFICABLE' : 'RTL TO SILICON · OPEN EDA FLOWS · VERIFIABLE DESIGN'}</span></footer>
  </div>
}
