import { apiFetch } from './auth'
import type { Experiment, SimulationResult } from './types'

export async function simulate(experiment: Experiment): Promise<SimulationResult> {
  return apiFetch('/api/v1/simulations/pn-junction', {
    method: 'POST', body: JSON.stringify(experiment),
  })
}
