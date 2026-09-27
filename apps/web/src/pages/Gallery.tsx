import { useEffect, useState } from 'react'
import { apiFetch } from '../auth'
import type { StoredProject } from '../projectStore'
import { PublicShell, go, usePublicLocale } from './shell'

type Row = { id: string; owner_email: string; name: string; data: StoredProject; updated_at: string }

export function Gallery() {
  const [locale] = usePublicLocale()
  const es = locale === 'es'
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    apiFetch('/api/v1/projects/gallery')
      .then(async r => { if (!r.ok) throw new Error(); setRows(await r.json()) })
      .catch(() => setError(es ? 'No se pudo cargar la galería.' : 'Could not load gallery.'))
  }, [])
  async function clone(row: Row) {
    setBusy(row.id); setError('')
    try {
      const res = await apiFetch('/api/v1/projects', { method: 'POST', body: JSON.stringify({ name: `${row.data.name} (${es ? 'copia' : 'copy'})`, data: row.data }) })
      if (!res.ok) throw new Error()
      go('#/lab')
    } catch { setError(es ? 'No se pudo clonar.' : 'Could not clone.') }
    finally { setBusy('') }
  }
  return <PublicShell>
    <section className="pub-hero slim">
      <p className="eyebrow">{es ? 'GALERÍA ABIERTA · TINKERCAD STYLE' : 'OPEN GALLERY'}</p>
      <h1>Diseños <span>de la comunidad.</span></h1>
      <p className="lede">{es ? 'Todo lo que se diseña aquí es visible y clonable por cualquier cuenta UNIS. Aprende de otros y comparte lo tuyo.' : 'Everything designed here is visible and cloneable by any UNIS account. Learn from others, share yours.'}</p>
    </section>
    {error && <p className="error">{error}</p>}
    <section className="team-grid">{rows.map(r => <article className="team-card" key={r.id}>
      <div><h2>{r.data.name}</h2><p className="role">{r.data.kind} · {r.data.pdk}</p>
        <a className="mail">{r.owner_email}</a>
        <div className="team-links"><button className="btn-primary" disabled={!!busy} onClick={() => void clone(r)}>{busy === r.id ? '…' : (es ? 'Clonar' : 'Clone')}</button></div>
      </div>
    </article>)}
      {!rows.length && !error && <p>…</p>}</section>
  </PublicShell>
}
