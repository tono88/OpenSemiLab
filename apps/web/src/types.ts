export type Mode = 'Explore' | 'Learn' | 'Design' | 'Advanced' | 'Research'

export interface Experiment {
  name: string
  engine: 'educational' | 'devsim'
  device: {
    kind: 'pn_junction_1d'; material: 'silicon'; length_um: number; area_um2: number
    acceptor_cm3: number; donor_cm3: number; temperature_k: number
  }
  sweep: { start_v: number; stop_v: number; points: number }
  numerics: { mesh_points: number; relative_tolerance: number; max_iterations: number }
}

export interface Series { name: string; x_label: string; x_unit: string; y_label: string; y_unit: string; x: number[]; y: number[] }
export interface SimulationResult {
  experiment_name: string
  metrics: { label: string; value: number; unit: string }[]
  series: Series[]
  explanations: string[]; warnings: string[]; converged: boolean
  provenance: { engine: string; engine_version: string; model: string; input_sha256: string; authoritative: boolean }
}
