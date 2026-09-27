import { PublicShell, usePublicLocale } from './shell'

const TEAM = [
  {
    photo: '/team/estuardo.jpg', qr: '/team/qr-estuardo.png',
    name: 'Estuardo Sandoval', email: 'esandoval@unis.edu.gt',
    roleEs: 'Automation & Software Manager · Scrum Master · PhD candidate', roleEn: 'Automation & Software Manager · Scrum Master · PhD candidate',
    link: 'https://www.linkedin.com/in/estuardoantoniosandoval/',
  },
  {
    photo: '/team/andre.jpg', qr: '/team/qr-andre.png',
    name: 'Jorge André Gil Leonardo', email: 'jagil@unis.edu.gt',
    roleEs: 'Ing. Electrónica (6.º semestre) · Full-stack Node.js + PostgreSQL · Redes, IoT y embebidos',
    roleEn: 'Electronics Eng. (6th semester) · Full-stack Node.js + PostgreSQL · Networks, IoT & embedded',
    link: 'https://www.linkedin.com/in/jorge-andr%C3%A9-gil-leonardo-b877482aa/',
  },
]

export function Team() {
  const [locale] = usePublicLocale()
  const es = locale === 'es'
  return <PublicShell>
    <section className="pub-hero slim">
      <p className="eyebrow">{es ? 'EQUIPO DE DESARROLLO' : 'DEVELOPMENT TEAM'}</p>
      <h1>{es ? 'Quién construye' : 'Who builds'}<br /><span>OpenSemiLab.</span></h1>
    </section>
    <section className="team-grid">
      {TEAM.map(p => <article className="team-card" key={p.email}>
        <img src={p.photo} alt={p.name} loading="lazy" />
        <div><h2>{p.name}</h2><p className="role">{es ? p.roleEs : p.roleEn}</p>
          <a className="mail" href={`mailto:${p.email}`}>{p.email}</a>
          <div className="team-links"><a href={p.link} target="_blank" rel="noreferrer">LinkedIn ↗</a></div>
        </div>
        <figure><img src={p.qr} alt={`QR LinkedIn ${p.name}`} loading="lazy" /><figcaption>LinkedIn QR</figcaption></figure>
      </article>)}
    </section>
  </PublicShell>
}
