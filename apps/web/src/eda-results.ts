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
  floorplan_mode?:'auto'|'manual'
  die_width_um?:number|null
  die_height_um?:number|null
  cell_count:number|null
  wns_ns:number|null
  tns_ns:number|null
  drc_violations:number|null
  estimated_critical_path_ns?:number|null
  estimated_max_frequency_mhz?:number|null
  recommended_period_ns?:number|null
  core_area_um2?:number|null
  stdcell_area_um2?:number|null
  actual_utilization_pct?:number|null
  setup_worst_slack_ns?:number|null
  hold_worst_slack_ns?:number|null
  max_slew_violations?:number|null
  max_cap_violations?:number|null
  max_fanout_violations?:number|null
  setup_violations?:number|null
  hold_violations?:number|null
  unmapped_cells?:number|null
  lvs_errors?:number|null
  antenna_violations?:number|null
  power_grid_violations?:number|null
  disconnected_pins?:number|null
  critical_disconnected_pins?:number|null
  recommended_die_width_um?:number|null
  recommended_die_height_um?:number|null
  missing_handoff_artifacts?:string[]
  signoff_blockers?:string[]
  signoff_warnings?:string[]
  signoff_status?:'pass'|'fail'|'review'
  production_ready?:boolean
  handoff_level?:string
  readiness_level?:'implementation_failed'|'implementation_review'|'hardened_block_candidate'
  constraint_scope?:string
  pdk_distribution_status?:string
  tapeout_readiness?:{
    schema:string
    status:'pass'|'fail'|'review'
    level:string
    production_ready:boolean
    checks:{id:string;label:string;status:'pass'|'fail'|'review'|'not_run';evidence:string}[]
    disclaimer:string
  }
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
