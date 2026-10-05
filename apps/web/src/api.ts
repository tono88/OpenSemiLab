import { authFetch } from './auth'
import type { Experiment, SimulationResult, ValidationResult } from './types'

const LOCAL_DEVSIM = import.meta.env.VITE_DEVSIM_LOCAL_URL || 'http://127.0.0.1:8787'

async function localRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${LOCAL_DEVSIM}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(payload.detail || `Local DEVSIM returned HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function devsimHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${LOCAL_DEVSIM}/health`, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch { return false }
}

export async function simulate(experiment: Experiment): Promise<SimulationResult> {
  if (experiment.engine === 'devsim') return localRequest('/api/v1/simulations/pn-junction', experiment)
  return authFetch('/api/v1/simulations/pn-junction', {
    method: 'POST', body: JSON.stringify(experiment),
  })
}

export async function validateDevsim(experiment: Experiment): Promise<ValidationResult> {
  return localRequest('/api/v1/validation/pn-junction', {
    experiment: { ...experiment, engine: 'devsim' }, mesh_points: [51, 101, 201],
  })
}

export async function compareBundles(left: Record<string, unknown>, right: Record<string, unknown>): Promise<Record<string, unknown>> {
  return localRequest('/api/v1/reproducibility/compare', { left, right })
}
