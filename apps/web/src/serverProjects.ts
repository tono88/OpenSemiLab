import { apiFetch } from './auth'
import { loadProjects, saveProjects, type StoredProject } from './projectStore'

const MAP_KEY = 'opensemilab.serverIds.v1'

function loadMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MAP_KEY) ?? '{}') } catch { return {} }
}
function saveMap(map: Record<string, string>) {
  try { localStorage.setItem(MAP_KEY, JSON.stringify(map)) } catch { /* offline */ }
}

type ServerRow = { id: string; name: string; data: StoredProject; updated_at: string }

function toStored(row: ServerRow): StoredProject {
  return { ...row.data, id: row.id, name: row.name }
}

/** Baja del servidor, fusiona con lo local (gana el más reciente) y sube lo nuevo. */
export async function syncProjects(): Promise<void> {
  const local = loadProjects()
  const map = loadMap()
  let rows: ServerRow[]
  try {
    const res = await apiFetch('/api/v1/projects')
    if (!res.ok) return
    rows = await res.json()
  } catch { return }
  const byId = new Map(rows.map(r => [r.id, r]))
  const byDataId = new Map(rows.map(r => [(r.data as StoredProject)?.id ?? '', r]))
  const merged: StoredProject[] = []
  let changed = false
  for (const p of local) {
    const serverId = map[p.id]
    const row = (serverId && byId.get(serverId)) || byId.get(p.id) || byDataId.get(p.id)
    if (!row) {
      try {
        const res = await apiFetch('/api/v1/projects', { method: 'POST', body: JSON.stringify({ name: p.name, data: p }) })
        if (res.ok) {
          const created: ServerRow = await res.json()
          map[p.id] = created.id
          merged.push({ ...p })
          changed = true
          continue
        }
      } catch { /* queda local, se reintenta luego */ }
      merged.push(p)
      continue
    }
    const serverTs = new Date(row.updated_at || 0).getTime()
    const localTs = new Date(p.updatedAt || 0).getTime()
    if (localTs > serverTs) {
      try {
        const res = await apiFetch(`/api/v1/projects/${row.id}`, { method: 'PUT', body: JSON.stringify({ name: p.name, data: p }) })
        if (res.ok) { merged.push({ ...p, id: row.id }); map[p.id] = row.id; changed = true; continue }
      } catch { /* conserva local */ }
      merged.push(p)
    } else {
      if (p.id !== row.id) { map[p.id] = row.id; changed = true }
      merged.push(toStored(row))
    }
  }
  const localIds = new Set(local.map(p => p.id))
  for (const row of rows) {
    const embedded = (row.data as StoredProject)?.id ?? ''
    if (!localIds.has(row.id) && ![...localIds].includes(embedded)) merged.push(toStored(row))
  }
  if (merged.length !== local.length) changed = true
  if (changed) saveMap(map)
  saveProjects(merged)
}

export async function pushProject(p: StoredProject): Promise<void> {
  const map = loadMap()
  try {
    if (map[p.id]) {
      await apiFetch(`/api/v1/projects/${map[p.id]}`, { method: 'PUT', body: JSON.stringify({ name: p.name, data: p }) })
      return
    }
    const res = await apiFetch('/api/v1/projects', { method: 'POST', body: JSON.stringify({ name: p.name, data: p }) })
    if (res.ok) {
      const created: ServerRow = await res.json()
      map[p.id] = created.id
      saveMap(map)
    }
  } catch { /* offline: queda local */ }
}

export async function deleteServerProject(localId: string): Promise<void> {
  const map = loadMap()
  const serverId = map[localId]
  if (!serverId) return
  try { await apiFetch(`/api/v1/projects/${serverId}`, { method: 'DELETE' }) } catch { /* offline */ }
  delete map[localId]
  saveMap(map)
}

export function trackEvent(tool: string, action: string, projectId = '', payload: Record<string, unknown> = {}) {
  apiFetch('/api/v1/events', { method: 'POST', body: JSON.stringify({ project_id: projectId, tool, action, payload }) }).catch(() => {})
}
