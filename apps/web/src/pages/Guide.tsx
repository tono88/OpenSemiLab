import { useEffect, useRef, useState } from 'react'
import { GUIDE } from './guideContent'
import { PublicShell, usePublicLocale } from './shell'
import './guide.css'

function currentSection() {
  const selected = new URLSearchParams(location.hash.split('?')[1] ?? '').get('seccion')
  return GUIDE.some(item => item.id === selected) ? selected! : 'access'
}

export default function Guide() {
  const [locale] = usePublicLocale()
  const es = locale === 'es'
  const [selected, setSelected] = useState(currentSection)
  const [search, setSearch] = useState('')
  const article = useRef<HTMLElement>(null)
  const chapter = GUIDE.find(item => item.id === selected) ?? GUIDE[0]
  const index = GUIDE.indexOf(chapter)
  const filtered = GUIDE.filter(item => `${item.title[locale]} ${item.summary[locale]} ${item.steps.map(s => s.body[locale]).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  useEffect(() => {
    const changed = () => setSelected(currentSection())
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  function choose(id: string) {
    setSelected(id); location.hash = `#/guia?seccion=${id}`
    requestAnimationFrame(() => { article.current?.scrollIntoView({ block: 'start' }); article.current?.focus({ preventScroll: true }) })
  }
  return <PublicShell>
    <section className="guide-hero"><p className="eyebrow">OPENSEMILAB · {es ? 'MANUAL DEL PORTAL' : 'PORTAL MANUAL'}</p><h1>{es ? 'De su primera prueba' : 'From your first test'}<br/><span>{es ? 'a un diseño con evidencia.' : 'to a design with evidence.'}</span></h1><p>{es ? 'Una guía práctica para recorrer el portal completo: cuenta, proyectos, editor, verificación, simulación, implementación, experimentos y administración.' : 'A practical guide to the complete portal: account, projects, editor, verification, simulation, implementation, experiments and administration.'}</p><div className="guide-hero-links"><a href="#/lab">{es ? 'Abrir el laboratorio' : 'Open the lab'} →</a><button onClick={() => choose('flow')}>{es ? 'Entender el flujo continuo' : 'Understand the continuous flow'}</button></div></section>
    <div className="guide-layout"><aside className="guide-index"><label>{es ? 'Buscar en la guía' : 'Search the guide'}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={es ? 'Reloj, SMTP, malla…' : 'Clock, SMTP, mesh…'}/></label><nav aria-label={es ? 'Capítulos de la guía' : 'Guide chapters'}>{filtered.map(item => <button key={item.id} onClick={() => choose(item.id)} aria-current={selected === item.id ? 'step' : undefined}><span>{String(GUIDE.indexOf(item) + 1).padStart(2, '0')}</span><b>{item.title[locale]}</b></button>)}</nav>{!filtered.length && <p>{es ? 'No hay capítulos que coincidan. Pruebe otro término.' : 'No matching chapters. Try another term.'}</p>}<small>{es ? 'Las capturas muestran el portal con proyectos y valores de demostración. Abra una imagen para ampliar las partes señaladas.' : 'Screenshots show the portal with demonstration projects and values. Open an image to enlarge its annotated areas.'}</small></aside>
      <article className="guide-article" ref={article} tabIndex={-1} aria-labelledby="guide-chapter-title"><header><span>{es ? 'CAPÍTULO' : 'CHAPTER'} {String(index + 1).padStart(2, '0')} / {GUIDE.length}</span><h2 id="guide-chapter-title">{chapter.title[locale]}</h2><p>{chapter.summary[locale]}</p></header>
        {chapter.id === 'flow' && <div className="guide-flow" aria-label={es ? 'Ciclo de diseño' : 'Design cycle'}>{['design', 'verification', 'simulation', 'physical', 'results'].map((id, i) => <button key={id} onClick={() => choose(id)}><span>0{i + 1}</span>{(es ? ['Diseño', 'Verificación', 'Simulación', 'GDSII', 'Resultados'] : ['Design', 'Verification', 'Simulation', 'GDSII', 'Results'])[i]}<small>{es ? 'Abrir instrucciones' : 'Open instructions'} →</small></button>)}</div>}
        {chapter.image && <figure><a href={`/guide/${chapter.image}`} target="_blank" rel="noreferrer" title={es ? 'Abrir captura ampliada' : 'Open enlarged screenshot'}><img key={chapter.image} src={`/guide/${chapter.image}`} alt={`${chapter.title[locale]}: ${chapter.callouts?.map((item, i) => `${i + 1}. ${item[locale]}`).join(' ')}`} loading="lazy" width="1360" height="900"/></a><figcaption>{es ? 'CAPTURA SEÑALADA · pulse para ampliar' : 'ANNOTATED SCREENSHOT · click to enlarge'}<ol>{chapter.callouts?.map((item, i) => <li key={item.en}><b>{i + 1}</b><span>{item[locale]}</span></li>)}</ol></figcaption></figure>}
        <ol className="guide-steps">{chapter.steps.map((step, i) => <li key={step.title.en}><span>{i + 1}</span><div><h3>{step.title[locale]}</h3><p>{step.body[locale]}</p></div></li>)}</ol>
        <div className="guide-checkpoint"><span>{es ? 'ANTES DE CONTINUAR' : 'BEFORE CONTINUING'}</span><p>{chapter.checkpoint[locale]}</p></div><aside className="guide-tip"><b>{es ? 'Para interpretar bien' : 'For careful interpretation'}</b><p>{chapter.tip[locale]}</p></aside>
        <nav className="guide-next" aria-label={es ? 'Continuar la guía' : 'Continue the guide'}>{index > 0 && <button onClick={() => choose(GUIDE[index - 1].id)}>← {GUIDE[index - 1].title[locale]}</button>}{index < GUIDE.length - 1 && <button onClick={() => choose(GUIDE[index + 1].id)}>{GUIDE[index + 1].title[locale]} →</button>}</nav>
      </article>
    </div>
  </PublicShell>
}
