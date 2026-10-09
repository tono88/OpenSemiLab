import type { Series } from '../types'

export type Locale = 'es' | 'en'
export type Text = { es: string; en: string }
export const text = (es: string, en = es): Text => ({ es, en })
export type DeviceId = 'material' | 'transport' | 'resistor' | 'hall' | 'pn' | 'pin' | 'zener' | 'schottky' | 'varactor' | 'tunnel' | 'led' | 'photodiode' | 'solar' | 'npn' | 'pnp' | 'nmos' | 'pmos' | 'jfet' | 'moscap' | 'igbt' | 'scr' | 'cmos' | 'rc' | 'rlc' | 'rectifier' | 'recombination' | 'diffusion' | 'implantation' | 'oxidation' | 'lithography' | 'etching' | 'deposition' | 'yield'
export type Category = 'foundations' | 'diodes' | 'transistors' | 'opto' | 'circuits' | 'fabrication'
export interface Parameter {
  key: string; label: Text; unit: string; default: number; min: number; max: number
  log?: boolean; intro?: boolean; integer?: boolean
}
export interface Device {
  id: DeviceId; category: Category; name: Text; symbol: string; summary: Text; story: Text
  parameters: Parameter[]; equations: string[]; assumptions: Text[]; references: string[]
}
export interface Config { device: DeviceId; parameters: Record<string, number>; points: number }
export interface LabSeries extends Series { label: Text; explanation: Text }
export interface Metric { id: string; label: Text; value: number; unit: string }
export interface Check { id: string; label: Text; passed: boolean; value: number; limit: number; unit: string }
export interface Result {
  config: Config; model: string; revision: string; engine: 'browser-analytic'
  series: LabSeries[]; metrics: Metric[]; checks: Check[]; warnings: Text[]
}
export interface Guide {
  id: string; device: DeviceId; title: Text; level: number; question: Text
  hypothesis: Text; steps: Text[]; expected: Text; parameters: Record<string, number>; series: string
}
export interface StudyRequest { type: 'sweep' | 'montecarlo'; parameter: string; variation: number; seed: number; samples: number }
export interface Study { request: StudyRequest; runs: { label: string; result: Result }[] }
export type WorkerRequest = { id: number; config: Config; study?: StudyRequest }
export type WorkerReply = { id: number; result?: Result; study?: Study; error?: string }
