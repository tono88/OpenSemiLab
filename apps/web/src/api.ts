import type { Experiment, SimulationResult } from './types'

export async function simulate(experiment: Experiment): Promise<SimulationResult> {
  const response = await fetch('/api/v1/simulations/pn-junction', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(experiment),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: 'Simulation failed' }))
    throw new Error(body.detail ?? 'Simulation failed')
  }
  return response.json()
}
