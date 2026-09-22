import type { Series } from './types'

export interface Artifact {
  name:string
  media_type:string
  content:string
  encoding?:'utf-8'|'base64'
  size_bytes?:number
  original_size_bytes?:number
}

export interface SimulationPlot {
  name:string
  analysis:string
  series:Series[]
}

export interface SimulationData {
  schema:string
  engine:string
  plots:SimulationPlot[]
}

export interface PhysicalSummary {
  schema:string
  pdk:string
  scl:string
  die_area_um2:number
  target_utilization_pct:number
  clock_period_ns?:number
  cell_count:number|null
  wns_ns:number|null
  tns_ns:number|null
  drc_violations:number|null
  estimated_critical_path_ns?:number|null
  estimated_max_frequency_mhz?:number|null
  recommended_period_ns?:number|null
}

export interface RunResult {
  job_id:string
  action?:string
  engine:string
  success:boolean
  exit_code:number
  output:string
  duration_ms:number
  artifacts:Artifact[]
  pdk?:string
  scl?:string
  simulation?:SimulationData
  summary?:PhysicalSummary
  formal_status?:'pass'|'fail'|'unknown'|'error'
  formal_mode?:'bmc'|'prove'
}

export interface RunSnapshot {
  id:string
  createdAt:string
  action:string
  engine:string
  success:boolean
  duration_ms:number
  simulation?:SimulationData
  summary?:PhysicalSummary
  formal_status?:'pass'|'fail'|'unknown'|'error'
}
