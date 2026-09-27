import { useEffect, useState } from 'react'
import { apiFetch } from '../auth'
import { PublicShell, go, usePublicLocale } from './shell'

type Stats = { users: number; verified: number; admins: number; projects: number; events: number; by_tool: Record<string, number>; by_action: Record<string, number> }
type AdminUser = { id: string; email: string; name: string; role: string; is_active: boolean; is_verified: boolean; created_at: string }
type AdminProject = { id: string; owner_email: string; name: string; updated_at: string }
type AdminEvent = { id: string; user_email: string; project_id: string; tool: string; action: string; created_at: string }

async function get<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function download(name: string, rows: Record<string, unknown>[]) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

export function Admin() {
  const [locale] = usePublicLocale()
  const es = locale === 'es'
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [tool, setTool] = useState('')
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      const [s, u, p, e] = await Promise.all([
        get<Stats>('/api/v1/admin/stats'),
        get<AdminUser[]>('/api/v1/admin/users'),
        get<AdminProject[]>('/api/v1/admin/projects'),
        get<AdminEvent[]>(`/api/v1/admin/events?limit=200${tool ? `&tool=${encodeURIComponent(tool)}` : ''}`),
      ])
      setStats(s); setUsers(u); setProjects(p); setEvents(e)
    } catch { setError(es ? 'No se pudo cargar (¿eres admin?)' : 'Could not load (admin only)') }
  }
  useEffect(() => { void load() }, [])

  async function patchUser(u: AdminUser, patch: Partial<AdminUser>) {
    const res = await apiFetch(`/api/v1/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    if (res.ok) void load()
    else setError(es ? 'No se pudo actualizar' : 'Could not update')
  }
  async function deleteProject(id: string) {
    if (!window.confirm(es ? '¿Borrar este proyecto?' : 'Delete this project?')) return
    await apiFetch(`/api/v1/admin/projects/${id}`, { method: 'DELETE' })
    void load()
  }

  return <PublicShell>
    <section className="pub-hero slim">
      <p className="eyebrow">ADMIN · UNIS LAB</p>
      <h1>Panel <span>admin.</span></h1>
    </section>
    {error && <p className="error">{error}</p>}
    {stats && <section className="pub-grid">
      <div><h3>{stats.users}</h3><p>{es ? 'usuarios' : 'users'} ({stats.verified} {es ? 'verificados' : 'verified'})</p></div>
      <div><h3>{stats.projects}</h3><p>{es ? 'proyectos' : 'projects'}</p></div>
      <div><h3>{stats.events}</h3><p>{es ? 'eventos de diseño' : 'design events'}</p></div>
      <div><h3>{Object.entries(stats.by_tool).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'}</h3><p>{es ? 'herramienta top' : 'top tool'}</p></div>
    </section>}
    <section className="admin-block">
      <h2>{es ? 'Usuarios' : 'Users'}</h2>
      <div className="admin-table">{users.map(u => <div key={u.id} className="admin-row">
        <b>{u.email}</b><small>{u.name} · {u.role}{u.is_verified ? '' : ' · SIN VERIFICAR'}{u.is_active ? '' : ' · DESACTIVADO'}</small>
        <span>
          <button onClick={() => void patchUser(u, { is_active: !u.is_active })}>{u.is_active ? (es ? 'Desactivar' : 'Deactivate') : (es ? 'Activar' : 'Activate')}</button>
          <button onClick={() => void patchUser(u, { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? '−admin' : '+admin'}</button>
        </span>
      </div>)}</div>
    </section>
    <section className="admin-block">
      <h2>{es ? 'Proyectos' : 'Projects'}</h2>
      <div className="admin-table">{projects.map(p => <div key={p.id} className="admin-row">
        <b>{p.name}</b><small>{p.owner_email} · {p.updated_at.slice(0, 10)}</small>
        <span><button onClick={() => void deleteProject(p.id)}>{es ? 'Borrar' : 'Delete'}</button></span>
      </div>)}</div>
    </section>
    <section className="admin-block">
      <div className="admin-head"><h2>{es ? 'Qué diseña la gente' : 'What people design'}</h2>
        <span><input placeholder="tool" value={tool} onChange={e => setTool(e.target.value)} /><button onClick={() => void load()}>{es ? 'Filtrar' : 'Filter'}</button>
        <button onClick={() => download('eventos.csv', events)}>CSV</button></span></div>
      <div className="admin-table">{events.map(e => <div key={e.id} className="admin-row">
        <b>{e.tool} · {e.action}</b><small>{e.user_email} · {e.created_at.slice(0, 16).replace('T', ' ')}</small>
      </div>)}</div>
    </section>
    <p className="auth-alt"><a onClick={() => go('#/lab')} style={{ cursor: 'pointer' }}>{es ? 'Volver al Lab' : 'Back to Lab'}</a></p>
  </PublicShell>
}
