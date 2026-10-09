import { getDevice, REFERENCES } from './catalogue'
import { REVISION, thermalVoltage } from './physics'
import type { LabSeries, Result, Study } from './types'

export interface Measurement { x: number[]; y: number[]; sigma?: number[] }
export interface Fit { slope: number; intercept: number; slopeStdError: number; interceptStdError: number; r2: number; rmse: number; n: number }
export interface Comparison { x: number[]; y: number[]; residual: number[]; rmse: number; mae: number; r2: number; n: number }
export function parseMeasurement(csv: string): Measurement {
  if (csv.length > 2_000_000) throw new Error('CSV demasiado grande (máximo 2 MB) / CSV exceeds 2 MB')
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  if (!lines.length) throw new Error('CSV vacío / Empty CSV')
  const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ','
  const output: Measurement = { x: [], y: [] }, sigmas: number[] = []
  let hasSigma: boolean | undefined
  for (const [index, line] of lines.entries()) {
    // Numeric data only. A first nonnumeric row is treated as a header.
    const cells = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, '').trim())
    const values = cells.map(Number)
    if (index === 0 && values.slice(0, 2).some(v => !Number.isFinite(v))) continue
    if (values.length < 2 || values.length > 3 || values.some(v => !Number.isFinite(v)) || cells.some(v => v === '')) throw new Error(`CSV fila ${index + 1}: use x,y[,sigma_y] numéricos con punto decimal / CSV row ${index + 1}: numeric x,y[,sigma_y], decimal point`)
    if (hasSigma === undefined) hasSigma = values.length === 3
    if ((values.length === 3) !== hasSigma || (hasSigma && values[2] <= 0)) throw new Error('σy debe ser positiva y estar en todas las filas / σy must be positive and present in every row')
    output.x.push(values[0]); output.y.push(values[1]); if (hasSigma) sigmas.push(values[2])
    if (output.x.length > 10000) throw new Error('Máximo 10000 mediciones / Maximum 10000 measurements')
  }
  if (output.x.length < 3) throw new Error('Se necesitan al menos tres mediciones / At least three measurements are required')
  if (hasSigma) output.sigma = sigmas
  return output
}
export function linearFit(x: number[], y: number[], sigma?: number[]): Fit {
  if (x.length !== y.length || x.length < 3 || (sigma && (sigma.length !== x.length || sigma.some(v => !(v > 0) || !Number.isFinite(v)))) || [...x, ...y].some(v => !Number.isFinite(v))) throw new Error('Datos insuficientes o inválidos para regresión / Insufficient or invalid regression data')
  const w = x.map((_, i) => sigma ? 1 / sigma[i] ** 2 : 1), sumW = w.reduce((a, b) => a + b, 0), meanX = x.reduce((a, v, i) => a + w[i] * v, 0) / sumW, meanY = y.reduce((a, v, i) => a + w[i] * v, 0) / sumW
  if (!Number.isFinite(sumW) || !(sumW > 0) || !Number.isFinite(meanX) || !Number.isFinite(meanY)) throw new Error('Escala o incertidumbres fuera del rango numérico de regresión / Regression scale or uncertainties exceed numeric range')
  const sxx = x.reduce((a, v, i) => a + w[i] * (v - meanX) ** 2, 0), sxy = x.reduce((a, v, i) => a + w[i] * (v - meanX) * (y[i] - meanY), 0)
  if (!(sxx > 0) || !Number.isFinite(sxx)) throw new Error('La variable x no tiene variación útil / x has no useful variation')
  const slope = sxy / sxx, intercept = meanY - slope * meanX, residual = y.map((v, i) => v - (slope * x[i] + intercept)), sse = residual.reduce((a, v, i) => a + w[i] * v * v, 0), syy = y.reduce((a, v, i) => a + w[i] * (v - meanY) ** 2, 0)
  // Given sigma is an absolute standard uncertainty, not a relative weight;
  // do not multiply its covariance by reduced chi-square.
  const variance = sigma ? 1 : sse / (x.length - 2)
  const result = { slope, intercept, slopeStdError: Math.sqrt(variance / sxx), interceptStdError: Math.sqrt(variance * (1 / sumW + meanX ** 2 / sxx)), r2: syy > 0 ? 1 - sse / syy : sse === 0 ? 1 : 0, rmse: Math.sqrt(residual.reduce((a, v) => a + v * v, 0) / x.length), n: x.length }
  if (Object.values(result).some(value => !Number.isFinite(value))) throw new Error('La regresión produjo valores no finitos / Regression produced nonfinite values')
  return result
}
export function diodeFit(measurement: Measurement, temperature: number, min: number, max: number) {
  const indices = measurement.x.flatMap((x, i) => x >= min && x <= max && measurement.y[i] > 0 ? [i] : [])
  const fit = linearFit(indices.map(i => measurement.x[i]), indices.map(i => Math.log(measurement.y[i])), measurement.sigma ? indices.map(i => measurement.sigma![i] / measurement.y[i]) : undefined)
  if (fit.slope <= 0) throw new Error('La región elegida no tiene pendiente exponencial positiva / Selected region has no positive exponential slope')
  const ideality = 1 / (fit.slope * thermalVoltage(temperature)), isat = Math.exp(fit.intercept)
  if (!(ideality > 0) || !(isat > 0) || !Number.isFinite(ideality) || !Number.isFinite(isat)) throw new Error('Parámetros extraídos fuera del rango numérico / Extracted parameters exceed numeric range')
  return { ...fit, ideality, isat }
}
export function interpolate(series: LabSeries, x: number): number | undefined {
  const pairs = series.x.map((x, i) => [x, series.y[i]]).sort((a, b) => a[0] - b[0])
  return interpolation(pairs, x)
}
function interpolation(pairs: number[][], x: number): number | undefined {
  if (x < pairs[0][0] || x > pairs.at(-1)![0]) return undefined
  let lo = 0, hi = pairs.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (pairs[mid][0] <= x) lo = mid; else hi = mid }
  if (pairs[lo][0] === x) return pairs[lo][1]
  const span = pairs[hi][0] - pairs[lo][0]
  return span === 0 ? pairs[lo][1] : pairs[lo][1] + (pairs[hi][1] - pairs[lo][1]) * (x - pairs[lo][0]) / span
}
export function compareMeasurement(measured: Measurement, model: LabSeries): Comparison {
  const pairs = model.x.map((x, i) => [x, model.y[i]]).sort((a, b) => a[0] - b[0]), x: number[] = [], y: number[] = [], residual: number[] = []
  measured.x.forEach((value, index) => { const predicted = interpolation(pairs, value); if (predicted !== undefined) { x.push(value); y.push(measured.y[index]); residual.push(measured.y[index] - predicted) } })
  if (x.length < 3) throw new Error('Menos de tres mediciones dentro del dominio de la curva; no se extrapola / Fewer than three measurements within model domain; no extrapolation')
  const mean = y.reduce((a, b) => a + b, 0) / y.length, sst = y.reduce((a, v) => a + (v - mean) ** 2, 0), sse = residual.reduce((a, v) => a + v * v, 0)
  return { x, y, residual, rmse: Math.sqrt(sse / x.length), mae: residual.reduce((a, v) => a + Math.abs(v), 0) / x.length, r2: sst > 0 ? 1 - sse / sst : sse === 0 ? 1 : 0, n: x.length }
}
export function statistics(values: number[]) {
  if (!values.length || values.some(v => !Number.isFinite(v))) throw new Error('Muestras inválidas / Invalid samples')
  const sorted = [...values].sort((a, b) => a - b), mean = values.reduce((a, b) => a + b, 0) / values.length
  const quantile = (q: number) => { const i = (sorted.length - 1) * q, lo = Math.floor(i); return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo) }
  return { n: values.length, mean, standardDeviation: values.length > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)) : 0, p05: quantile(.05), median: quantile(.5), p95: quantile(.95) }
}
const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
export function seriesCsv(series: LabSeries): string { return [[`${series.x_label} (${series.x_unit})`, `${series.y_label} (${series.y_unit})`], ...series.x.map((x, i) => [x, series.y[i]])].map(row => row.map(csvCell).join(',')).join('\n') }
export async function reproducibilityBundle(result: Result, notebook: Record<string, unknown>, study?: Study | null) {
  const device = getDevice(result.config.device), parameters = JSON.stringify({ revision: REVISION, config: result.config })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parameters)), fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return {
    schema: 'opensemilab.device-lab/1', created_at: new Date().toISOString(), input_sha256: fingerprint,
    execution: { host: 'client-browser', engine: result.engine, revision: REVISION, authoritative: false, measured: false },
    constants: { elementary_charge_C: 1.602176634e-19, boltzmann_J_K: 1.380649e-23, planck_J_s: 6.62607015e-34, speed_of_light_m_s: 299792458 },
    assumptions: device.assumptions, equations: device.equations, references: device.references.map(id => REFERENCES[id]),
    result, study: study ?? null, notebook,
    interpretation: 'Calculated analytic/compact reference data. Numerical consistency checks and sample statistics do not establish hardware agreement or process calibration. Animation is conceptual and is not sampled simulation data.',
  }
}
export function downloadFile(filename: string, content: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type: mime })), link = document.createElement('a')
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
