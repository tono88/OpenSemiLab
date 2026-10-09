/** Browser-side reference models. Units are cm, s, V and A internally unless
 * a model explicitly says SI. These are analytic/compact models, never TCAD
 * or calibrated fabrication results. Every run retains its exact inputs. */
import { getDevice } from './catalogue'
import { text as t, type Check, type Config, type LabSeries, type Metric, type Result, type Study, type StudyRequest, type Text } from './types'

export const REVISION = 'device-lab-1.0.0'
export const Q = 1.602176634e-19 // C, exact SI definition
export const KB = 1.380649e-23 // J/K, exact SI definition
export const H = 6.62607015e-34 // J s, exact SI definition
export const C = 299792458 // m/s, exact SI definition
export const EPS0 = 8.8541878128e-14 // F/cm; not an exact SI constant
export const EPS_SI = 11.7 * EPS0
export const EPS_OX = 3.9 * EPS0
export const thermalVoltage = (temperature: number) => KB * temperature / Q
export const bandgap = (temperature: number) => 1.17 - 4.73e-4 * temperature ** 2 / (temperature + 636)
export function intrinsic(temperature: number): number {
  // Teaching reference ni(300 K) = 1e10 cm^-3, normalized Varshni scaling.
  return 1e10 * (temperature / 300) ** 1.5 * Math.exp(bandgap(300) / (2 * thermalVoltage(300)) - bandgap(temperature) / (2 * thermalVoltage(temperature)))
}
export function carriers(netDoping: number, ni: number): { n: number; p: number } {
  // Stable quadratic: avoid subtracting two nearly equal large quantities.
  const majority = (Math.abs(netDoping) + Math.hypot(netDoping, 2 * ni)) / 2
  return netDoping >= 0 ? { n: majority, p: ni * ni / majority } : { n: ni * ni / majority, p: majority }
}
export const linspace = (start: number, stop: number, points: number) => Array.from({ length: points }, (_, i) => start + (stop - start) * i / (points - 1))
export const logspace = (start: number, stop: number, points: number) => linspace(Math.log10(start), Math.log10(stop), points).map(x => 10 ** x)
const expm1 = (x: number) => {
  // Refuse overflow rather than silently flattening an exponential I–V curve.
  if (x > 700) throw new Error('Exponente fuera del rango numérico: reduzca la tensión o revise T e idealidad / Exponent exceeds numeric range: reduce voltage or review T and ideality')
  return Math.expm1(Math.max(-700, x))
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
export function derivative(x: number[], y: number[]): number[] {
  return x.map((_, i) => { const lo = Math.max(0, i - 1), hi = Math.min(x.length - 1, i + 1); return (y[hi] - y[lo]) / (x[hi] - x[lo]) })
}
export function integral(x: number[], y: number[]): number { return x.slice(1).reduce((sum, value, i) => sum + (value - x[i]) * (y[i] + y[i + 1]) / 2, 0) }
export function erf(x: number): number {
  // Abramowitz-Stegun 7.1.26, maximum absolute error about 1.5e-7.
  const sign = x < 0 ? -1 : 1, u = 1 / (1 + .3275911 * Math.abs(x))
  return sign * (1 - (((((1.061405429 * u - 1.453152027) * u) + 1.421413741) * u - .284496736) * u + .254829592) * u * Math.exp(-x * x))
}
export function bisect(fn: (x: number) => number, lo: number, hi: number, iterations = 80): number {
  let flo = fn(lo), fhi = fn(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) throw new Error('El modelo no tiene una raíz acotada en este intervalo / No bracketed root in this range')
  for (let i = 0; i < iterations; i++) { const mid = (lo + hi) / 2, value = fn(mid); if (value === 0) return mid; if (value * flo > 0) { lo = mid; flo = value } else { hi = mid; fhi = value } }
  return (lo + hi) / 2
}
export function normalizeConfig(config: Config): Config {
  const device = getDevice(config.device)
  if (!Number.isInteger(config.points) || config.points < 41 || config.points > 1001) throw new Error('Muestreo permitido: 41–1001 puntos / Sampling: 41–1001 points')
  const parameters: Record<string, number> = {}
  for (const spec of device.parameters) {
    const value = config.parameters[spec.key]
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) throw new Error(`${spec.label.es} / ${spec.label.en}: ${spec.min} ≤ valor ≤ ${spec.max} ${spec.unit}`)
    parameters[spec.key] = value
  }
  if ('start' in parameters && parameters.stop <= parameters.start) throw new Error('El fin del barrido debe superar al inicio / Sweep end must exceed start')
  return { device: config.device, points: config.points, parameters }
}
const series = (name: string, label: Text, x: number[], y: number[], xLabel: string, xUnit: string, yLabel: string, yUnit: string, explanation: Text): LabSeries => ({ name, label, x, y, x_label: xLabel, x_unit: xUnit, y_label: yLabel, y_unit: yUnit, explanation })
const metric = (id: string, label: Text, value: number, unit: string): Metric => ({ id, label, value, unit })
const check = (id: string, label: Text, value: number, limit: number, unit = '1'): Check => ({ id, label, value, limit, unit, passed: Number.isFinite(value) && Math.abs(value) <= limit })
const relative = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)
const mobilityN = (temperature: number) => 1350 * (300 / temperature) ** 2.2
const mobilityP = (temperature: number) => 480 * (300 / temperature) ** 2.2
const shockley = (v: number, is: number, n: number, vt: number) => is * expm1(v / (n * vt))

export function junction(na: number, nd: number, temperature: number, bias = 0, intrinsicUm = 0) {
  const vt = thermalVoltage(temperature), ni = intrinsic(temperature), vbi = vt * Math.log(na * nd / (ni * ni)), barrier = Math.max(0, vbi - bias), wi = intrinsicUm * 1e-4
  if (vbi <= 0) throw new Error('El modelo de agotamiento requiere dopaje extrínseco a esta temperatura: aumente NA/ND o reduzca T / Depletion model requires extrinsic doping: increase NA/ND or reduce T')
  const a = EPS_SI / (2 * Q) * (1 / na + 1 / nd)
  const field = barrier === 0 ? 0 : 2 * barrier / (wi + Math.sqrt(wi * wi + 4 * a * barrier))
  const xp = EPS_SI * field / (Q * na), xn = EPS_SI * field / (Q * nd)
  return { vt, ni, vbi, barrier, field, xp, xn, wi, width: xp + wi + xn }
}
export function mosCurrent(vg: number, vd: number, threshold: number, beta: number, lambda: number, vt: number): number {
  // A soft overdrive (n=1.5) avoids a discontinuity at threshold. This is a
  // compact interpolation, not a process-calibrated weak-inversion model.
  const u = (vg - threshold) / (1.5 * vt), overdrive = 1.5 * vt * (u > 40 ? u : Math.log1p(Math.exp(u)))
  const current = vd < overdrive ? beta * (overdrive * vd - vd * vd / 2) : beta * overdrive * overdrive / 2
  return current * (1 + lambda * vd)
}
export function mosCharge(psi: number, acceptors: number, temperature: number): number {
  const vt = thermalVoltage(temperature), { n, p } = carriers(-acceptors, intrinsic(temperature)), u = psi / vt
  const term = p * (expm1(-u) + u) + n * (expm1(u) - u)
  return -Math.sign(psi) * Math.sqrt(Math.max(0, 2 * EPS_SI * Q * vt * term))
}

export function simulateDevice(input: Config): Result {
  const config = normalizeConfig(input), p = config.parameters, count = config.points, id = config.device
  const result: Result = { config, engine: 'browser-analytic', revision: REVISION, model: `${id} / analytic-compact`, series: [], metrics: [], checks: [], warnings: [] }
  const curves = result.series, metrics = result.metrics, checks = result.checks, warnings = result.warnings
  const temp = p.temperature ?? 300, vt = thermalVoltage(temp), ni = intrinsic(temp)
  const add = (name: string, label: Text, x: number[], y: number[], xl: string, xu: string, yl: string, yu: string, explanation: Text) => curves.push(series(name, label, x, y, xl, xu, yl, yu, explanation))
  const m = (name: string, label: Text, value: number, unit: string) => metrics.push(metric(name, label, value, unit))
  const warn = (es: string, en: string) => warnings.push(t(es, en))
  if ((p.na ?? 0) > 1e18 || (p.nd ?? 0) > 1e18) warn('Dopaje alto: la estadística no degenerada y la movilidad fija dejan de ser buenas aproximaciones.', 'High doping: nondegenerate statistics and fixed mobility become poor approximations.')

  if (id === 'material') {
    const temperatures = linspace(200, 450, count), net = p.nd - p.na
    const electron = temperatures.map(t => carriers(net, intrinsic(t)).n), hole = temperatures.map(t => carriers(net, intrinsic(t)).p)
    const density = carriers(net, ni), sigma = Q * (mobilityN(temp) * density.n + mobilityP(temp) * density.p)
    add('electrons', t('Electrones n', 'Electrons n'), temperatures, electron, 'Temperature', 'K', 'n', 'cm⁻³', t('La neutralidad y np = ni² determinan n y p; el dopaje compensado puede dejar un material casi intrínseco.', 'Neutrality and np = ni² determine n and p; compensated doping can leave nearly intrinsic material.'))
    add('holes', t('Huecos p', 'Holes p'), temperatures, hole, 'Temperature', 'K', 'p', 'cm⁻³', t('Al aumentar ni con T, también aumenta la concentración minoritaria.', 'Increasing ni with temperature also increases minority concentration.'))
    add('conductivity', t('Conductividad', 'Conductivity'), temperatures, temperatures.map((t, i) => Q * (mobilityN(t) * electron[i] + mobilityP(t) * hole[i])), 'Temperature', 'K', 'Conductivity', 'S/cm', t('Se suman las contribuciones electrónicas y de huecos; la movilidad usa una ley térmica ilustrativa.', 'Electron and hole contributions add; mobility uses an illustrative temperature law.'))
    add('bandgap', t('Banda prohibida', 'Band gap'), temperatures, temperatures.map(bandgap), 'Temperature', 'K', 'Eg', 'eV', t('La parametrización de Varshni usada para silicio reduce Eg al aumentar T.', 'The silicon Varshni parametrization reduces Eg as temperature rises.'))
    m('n', t('Electrones', 'Electrons'), density.n, 'cm⁻³'); m('p', t('Huecos', 'Holes'), density.p, 'cm⁻³'); m('ni', t('Concentración intrínseca', 'Intrinsic concentration'), ni, 'cm⁻³'); m('resistivity', t('Resistividad', 'Resistivity'), 1 / sigma, 'Ω·cm')
    checks.push(check('mass_action', t('Ley de acción de masas: error relativo', 'Mass-action law: relative error'), relative(density.n * density.p, ni * ni), 1e-12), check('neutrality', t('Neutralidad: error normalizado', 'Neutrality: normalized error'), Math.abs(density.n - density.p - net) / Math.max(density.n, density.p), 1e-12))
  } else if (id === 'transport') {
    const x = linspace(-p.depth / 2, p.depth / 2, count), n = x.map(x => p.nd + p.gradient * x * 1e-4), mu = mobilityN(temp), dn = mu * vt
    if (Math.min(...n) <= 0) throw new Error('Este gradiente produce densidades negativas: reduzca |dn/dx| o la longitud / Gradient produces negative density: reduce |dn/dx| or length')
    const drift = n.map(n => Q * mu * n * p.field), diffusion = x.map(() => Q * dn * p.gradient)
    add('density', t('Perfil de electrones', 'Electron profile'), x, n, 'Position', 'µm', 'n', 'cm⁻³', t('Perfil lineal prescrito; no es una solución autoconsistente de continuidad.', 'Prescribed linear profile; not a self-consistent continuity solution.'))
    add('drift', t('Corriente de deriva Jn', 'Drift current Jn'), x, drift, 'Position', 'µm', 'Jn drift', 'A/cm²', t('Los electrones se mueven contra E; su corriente convencional de deriva tiene el signo de E.', 'Electrons move against E; their conventional drift current has the sign of E.'))
    add('diffusion', t('Corriente de difusión Jn', 'Diffusion current Jn'), x, diffusion, 'Position', 'µm', 'Jn diffusion', 'A/cm²', t('Los electrones difunden hacia menor n; la corriente convencional tiene el signo contrario a su movimiento.', 'Electrons diffuse toward lower n; conventional current is opposite to their motion.'))
    add('total', t('Corriente total Jn', 'Total current Jn'), x, drift.map((v, i) => v + diffusion[i]), 'Position', 'µm', 'Jn', 'A/cm²', t('Suma de deriva y difusión; si varía con x, mantener el perfil exige fuentes o un transitorio.', 'Sum of drift and diffusion; spatial variation requires sources or transient evolution to maintain the profile.'))
    m('mobility', t('Movilidad de electrones', 'Electron mobility'), mu, 'cm²/(V·s)'); m('diffusion', t('Difusividad Dn', 'Diffusivity Dn'), dn, 'cm²/s'); m('length', t('Longitud de difusión', 'Diffusion length'), Math.sqrt(dn * p.tau * 1e-9) * 1e4, 'µm'); m('vt', t('Tensión térmica', 'Thermal voltage'), vt, 'V')
    checks.push(check('einstein', t('Relación de Einstein: error relativo', 'Einstein relation: relative error'), relative(dn / mu, vt), 1e-12))
  } else if (id === 'resistor') {
    const r = p.length * 1e-4 / (Q * mobilityN(temp) * p.nd * p.area * 1e-8), v = linspace(p.start, p.stop, count), i = v.map(v => v / r)
    add('iv', t('Ley de Ohm I–V', 'Ohmic I–V'), v, i, 'Voltage', 'V', 'Current', 'A', t('La pendiente es 1/R. ND representa una región N uniforme, sin compensación.', 'The slope is 1/R. ND represents a uniform N region without compensation.'))
    add('power', t('Disipación', 'Dissipation'), v, i.map((i, index) => i * v[index]), 'Voltage', 'V', 'Power', 'W', t('P es positiva en ambas polaridades; el cálculo no acopla el calentamiento.', 'Power is positive for either polarity; self-heating is not coupled.'))
    m('resistance', t('Resistencia', 'Resistance'), r, 'Ω'); m('resistivity', t('Resistividad', 'Resistivity'), 1 / (Q * mobilityN(temp) * p.nd), 'Ω·cm'); m('max_power', t('Potencia máxima del barrido', 'Maximum swept power'), Math.max(...i.map((value, index) => value * v[index])), 'W')
  } else if (id === 'hall') {
    const b = linspace(-p.magnetic, p.magnetic, count), rh = -1 / (Q * p.nd * 1e6), voltage = b.map(b => rh * p.current * 1e-3 * b / (p.thickness * 1e-6))
    add('hall', t('Tensión Hall', 'Hall voltage'), b, voltage, 'Magnetic field', 'T', 'Hall voltage', 'V', t('Con esta orientación, el signo negativo corresponde a portadores electrónicos.', 'With this orientation, negative sign corresponds to electron carriers.'))
    m('coefficient', t('Coeficiente Hall', 'Hall coefficient'), rh, 'm³/C'); m('sensitivity', t('Sensibilidad', 'Sensitivity'), rh * p.current * 1e-3 / (p.thickness * 1e-6), 'V/T')
  } else if (id === 'pn' || id === 'pin') {
    const j = junction(p.na, p.nd, temp, p.bias, p.intrinsic ?? 0), halfUm = Math.max(1, j.width * 1e4 * 1.1), x = linspace(-halfUm, halfUm, count)
    const potential: number[] = [], field: number[] = [], charge: number[] = []
    for (const xx of x) {
      const z = xx * 1e-4, left = -j.wi / 2, right = j.wi / 2
      if (z < left - j.xp) { potential.push(0); field.push(0); charge.push(0) }
      else if (z < left) { const d = z - left + j.xp; potential.push(Q * p.na * d * d / (2 * EPS_SI)); field.push(-Q * p.na * d / EPS_SI); charge.push(-Q * p.na) }
      else if (z <= right && j.wi > 0) { potential.push(Q * p.na * j.xp * j.xp / (2 * EPS_SI) + j.field * (z - left)); field.push(-j.field); charge.push(0) }
      else if (z < right + j.xn) { const d = right + j.xn - z; potential.push(j.barrier - Q * p.nd * d * d / (2 * EPS_SI)); field.push(-Q * p.nd * d / EPS_SI); charge.push(Q * p.nd) }
      else { potential.push(j.barrier); field.push(0); charge.push(0) }
    }
    const explanation = t('Aproximación de agotamiento; los contactos están fuera del intervalo agotado. El campo es −dψ/dx.', 'Depletion approximation; contacts lie outside the depleted region. Electric field is −dψ/dx.')
    add('potential', t('Potencial', 'Potential'), x, potential, 'Position', 'µm', 'Potential', 'V', explanation)
    add('electric_field', t('Campo eléctrico', 'Electric field'), x, field, 'Position', 'µm', 'E', 'V/cm', explanation)
    add('charge_density', t('Carga espacial', 'Space charge'), x, charge, 'Position', 'µm', 'Charge density', 'C/cm³', t('Los iones fijos P son negativos y los N positivos; las cargas de agotamiento se compensan.', 'Fixed P ions are negative and N ions positive; depletion charges balance.'))
    add('electrons', t('Electrones n(x)', 'Electrons n(x)'), x, potential.map(psi => p.nd * Math.exp(Math.max(-700, (psi - j.barrier) / vt))), 'Position', 'µm', 'n', 'cm⁻³', t('Perfil Boltzmann con cuasi-Fermi constante a través de la zona de agotamiento. No resuelve continuidad en regiones neutras.', 'Boltzmann profile with constant quasi-Fermi level across depletion. Does not solve continuity in neutral regions.'))
    add('holes', t('Huecos p(x)', 'Holes p(x)'), x, potential.map(psi => p.na * Math.exp(Math.max(-700, -psi / vt))), 'Position', 'µm', 'p', 'cm⁻³', t('En directa aumenta la población minoritaria; en alta inyección esta aproximación deja de ser válida.', 'Forward bias increases minority concentration; this approximation fails at high injection.'))
    const ecLeft = bandgap(temp) / 2 + vt * Math.log(p.na / ni)
    add('conduction_band', t('Banda de conducción Ec', 'Conduction band Ec'), x, potential.map(psi => ecLeft - psi), 'Position', 'µm', 'Ec relative to EF,P', 'eV', t('Las bandas siguen −ψ. La referencia de energía es EF del lado P, no el vacío.', 'Bands follow −ψ. Energy is referenced to P-side EF, not vacuum.'))
    add('valence_band', t('Banda de valencia Ev', 'Valence band Ev'), x, potential.map(psi => ecLeft - psi - bandgap(temp)), 'Position', 'µm', 'Ev relative to EF,P', 'eV', t('Ec − Ev es el Eg de silicio a la temperatura seleccionada.', 'Ec − Ev is the silicon gap at the selected temperature.'))
    const v = linspace(p.start, p.stop, count), current = v.map(v => shockley(v, p.isat, p.ideality, vt)), reverse = linspace(0, 10, count)
    add('iv', t('Curva I–V', 'I–V curve'), v, current, 'Voltage', 'V', 'Current', 'A', t('Shockley con Is y n editables; esta I–V compacta no procede de los perfiles de agotamiento.', 'Shockley with editable Is and n; this compact I–V is not obtained from depletion profiles.'))
    add('capacitance', t('C–V inversa', 'Reverse C–V'), reverse, reverse.map(v => EPS_SI * p.area * 1e-8 / junction(p.na, p.nd, temp, -v, p.intrinsic ?? 0).width * 1e12), 'Reverse voltage', 'V', 'Capacitance', 'pF', t('Capacitancia de agotamiento εA/W; excluye capacitancia de difusión.', 'Depletion capacitance εA/W; excludes diffusion capacitance.'))
    m('vbi', t('Potencial incorporado', 'Built-in potential'), j.vbi, 'V'); m('width', t('Ancho de agotamiento', 'Depletion width'), j.width * 1e4, 'µm'); m('field', t('Campo máximo |E|', 'Peak |E|'), j.field, 'V/cm'); m('vt', t('Tensión térmica', 'Thermal voltage'), vt, 'V')
    checks.push(check('charge_balance', t('Neutralidad de agotamiento: error relativo', 'Depletion neutrality: relative error'), relative(p.na * j.xp, p.nd * j.xn), 1e-12), check('barrier', t('Integración de campo: error relativo', 'Integrated field: relative error'), relative(Q * p.na * j.xp ** 2 / (2 * EPS_SI) + j.field * j.wi + Q * p.nd * j.xn ** 2 / (2 * EPS_SI), j.barrier), 1e-12))
    if (id === 'pin') m('transit', t('Tránsito estimado en I (velocidad 10⁷ cm/s)', 'Estimated I transit (10⁷ cm/s velocity)'), j.wi / 1e7 * 1e9, 'ns')
    if (p.bias >= j.vbi - 3 * vt) warn('Cerca o por encima de banda plana: los perfiles de agotamiento no representan una solución de alta inyección.', 'Near or above flat band: depletion profiles do not represent a high-injection solution.')
    if (Math.min(p.na, p.nd) < 10 * ni) warn('Dopaje cercano a ni: la aproximación de agotamiento extrínseco pierde precisión.', 'Doping near ni: extrinsic depletion approximation loses accuracy.')
    if (p.stop > .75) warn('Directa elevada: Shockley ideal no incluye resistencia serie, alta inyección ni autocalentamiento.', 'Large forward bias: ideal Shockley excludes series resistance, high injection and self-heating.')
    if (j.field > 2e5) warn('Campo elevado: el modelo no calcula avalancha ni ruptura.', 'High field: this model does not calculate avalanche or breakdown.')
  } else if (id === 'zener') {
    const v = linspace(p.start, p.stop, count), current = v.map(v => v < -p.breakdown ? (v + p.breakdown) / p.dynamic - p.isat : shockley(v, p.isat, p.ideality, vt))
    add('iv', t('I–V y ruptura', 'I–V and breakdown'), v, current, 'Voltage', 'V', 'Current', 'A', t('La rama inversa es una aproximación lineal parametrizada por Vz y rz.', 'Reverse branch is a linear approximation parameterized by Vz and rz.'))
    add('power', t('Potencia disipada', 'Dissipated power'), v, current.map((i, index) => Math.abs(i * v[index])), 'Voltage', 'V', 'Power', 'W', t('Se muestra potencia sin límite térmico; use una resistencia de protección en un circuito real.', 'Power is shown without a thermal limit; use a protective resistor in a real circuit.'))
    add('conductance', t('Conductancia diferencial', 'Differential conductance'), v, derivative(v, current), 'Voltage', 'V', 'dI/dV', 'S', t('En la rama de ruptura la pendiente tiende a 1/rz.', 'Breakdown-branch slope tends to 1/rz.'))
    m('breakdown', t('Tensión Zener nominal', 'Nominal Zener voltage'), p.breakdown, 'V'); m('dynamic', t('Resistencia dinámica', 'Dynamic resistance'), p.dynamic, 'Ω')
  } else if (id === 'schottky') {
    const is = p.area * 1e-8 * p.richardson * temp * temp * Math.exp(-p.barrier / vt), v = linspace(p.start, p.stop, count), current = v.map(v => shockley(v, is, p.ideality, vt))
    add('iv', t('I–V termoiónica', 'Thermionic I–V'), v, current, 'Voltage', 'V', 'Current', 'A', t('Is depende del área, A*, T² y la barrera. No se incorpora resistencia serie.', 'Is depends on area, A*, T² and barrier height. Series resistance is not included.'))
    add('conductance', t('Conductancia diferencial', 'Differential conductance'), v, current.map(i => (i + is) / (p.ideality * vt)), 'Voltage', 'V', 'dI/dV', 'S', t('La pendiente local sigue la rama exponencial de emisión ideal.', 'Local slope follows ideal exponential emission.'))
    m('isat', t('Corriente de saturación calculada', 'Calculated saturation current'), is, 'A'); m('barrier', t('Barrera efectiva', 'Effective barrier'), p.barrier, 'eV'); m('vt', t('Tensión térmica', 'Thermal voltage'), vt, 'V')
  } else if (id === 'varactor') {
    const j = junction(p.na, p.nd, temp), v = linspace(0, p.reverse, count), cap = v.map(v => EPS_SI * p.area * 1e-8 / junction(p.na, p.nd, temp, -v).width * 1e12)
    add('capacitance', t('Capacitancia de agotamiento', 'Depletion capacitance'), v, cap, 'Reverse voltage', 'V', 'Capacitance', 'pF', t('Una unión abrupta ideal sigue C ∝ (Vbi + VR)⁻¹/².', 'An ideal abrupt junction follows C ∝ (Vbi + VR)⁻¹/².'))
    add('inverse_capacitance', t('Linealización 1/C²', '1/C² linearization'), v, cap.map(c => 1 / (c * c)), 'Reverse voltage', 'V', '1/C²', 'pF⁻²', t('La pendiente permite estimar dopaje equivalente si el área y las unidades son conocidas.', 'Slope can estimate effective doping when area and units are known.'))
    m('c0', t('Capacitancia a 0 V', 'Zero-bias capacitance'), cap[0], 'pF'); m('ratio', t('Relación C(0)/C(Vmax)', 'Ratio C(0)/C(Vmax)'), cap[0] / cap.at(-1)!, '1'); m('vbi', t('Potencial incorporado', 'Built-in potential'), j.vbi, 'V')
  } else if (id === 'tunnel') {
    const v = linspace(0, p.stop, count), tunnel = v.map(v => p.peak_current * 1e-3 * v / p.peak * Math.exp(1 - v / p.peak)), current = tunnel.map((i, index) => i + 1e-9 * expm1(v[index] / .04))
    add('iv', t('Curva I–V equivalente', 'Equivalent I–V'), v, current, 'Voltage', 'V', 'Current', 'A', t('Suma de una rama de pico fenomenológica y una rama exponencial; no se integra transmisión cuántica.', 'Sum of a phenomenological peak and exponential branch; quantum transmission is not integrated.'))
    add('conductance', t('Conductancia diferencial', 'Differential conductance'), v, derivative(v, current), 'Voltage', 'V', 'dI/dV', 'S', t('La zona negativa identifica resistencia diferencial negativa, no potencia negativa.', 'Negative values identify negative differential resistance, not negative power.'))
    m('peak', t('Vp del término de túnel', 'Tunnel-term Vp'), p.peak, 'V'); m('peak_current', t('Ip del término de túnel', 'Tunnel-term Ip'), p.peak_current, 'mA')
  } else if (id === 'led') {
    const v = linspace(0, p.stop, count), current = v.map(v => v === 0 ? 0 : bisect(i => p.ideality * vt * Math.log1p(i / p.isat) + i * p.series_resistance - v, 0, v / p.series_resistance))
    const optical = current.map(i => p.efficiency / 100 * i * p.bandgap), electrical = current.map((i, index) => i * v[index]), wavelength = H * C / (p.bandgap * Q) * 1e9
    add('iv', t('I–V con resistencia serie', 'I–V with series resistance'), v, current, 'Voltage', 'V', 'Current', 'A', t('La raíz implícita incorpora Rs; Is y n determinan el umbral efectivo de conducción.', 'An implicit root includes Rs; Is and n determine the effective conduction onset.'))
    add('optical_power', t('Potencia óptica', 'Optical power'), v, optical, 'Voltage', 'V', 'Optical power', 'W', t('Popt = EQE · I · energía del fotón en eV. La energía del fotón es una entrada independiente.', 'Popt = EQE · I · photon energy in eV. Photon energy is an independent input.'))
    add('electrical_power', t('Potencia eléctrica', 'Electrical power'), v, electrical, 'Voltage', 'V', 'Electrical power', 'W', t('Compare Pin con Popt; combinaciones independientes pueden producir una EQE/energía físicamente incompatible.', 'Compare electrical input with optical output; independent settings can give physically incompatible EQE/energy.'))
    m('wavelength', t('Longitud de onda nominal', 'Nominal wavelength'), wavelength, 'nm'); m('current', t('Corriente al final del barrido', 'Sweep-end current'), current.at(-1)!, 'A'); m('optical', t('Potencia óptica al final', 'Sweep-end optical power'), optical.at(-1)!, 'W')
    const violation = Math.max(...optical.map((power, i) => power - electrical[i]))
    checks.push(check('energy', t('Exceso Póptica − Peléctrica (máximo)', 'Maximum optical − electrical power excess'), Math.max(0, violation), 1e-12, 'W'))
    if (violation > 1e-12) warn('Estas entradas predicen más potencia óptica que eléctrica: reduzca EQE o revise Is, energía del fotón y rango de operación.', 'These inputs predict more optical than electrical power: reduce EQE or review Is, photon energy and operating range.')
  } else if (id === 'photodiode') {
    const responsivity = p.efficiency / 100 * Q * p.wavelength * 1e-9 / (H * C), photo = responsivity * p.power * 1e-6, v = linspace(p.start, p.stop, count), current = v.map(v => shockley(v, p.isat, 1, vt) - photo), fc = 1 / (2 * Math.PI * p.resistance * p.capacitance * 1e-12), f = logspace(fc / 100, fc * 100, count)
    add('iv', t('I–V con iluminación', 'Illuminated I–V'), v, current, 'Voltage', 'V', 'Current (into anode)', 'A', t('La fotocorriente resta a la corriente entrante al ánodo; el signo de entrega de energía se documenta.', 'Photocurrent subtracts from current entering the anode; power-delivery sign is documented.'))
    add('dark', t('I–V oscura', 'Dark I–V'), v, v.map(v => shockley(v, p.isat, 1, vt)), 'Voltage', 'V', 'Current (into anode)', 'A', t('La diferencia con la curva iluminada es Iph = Rλ P.', 'Difference from the illuminated curve is Iph = Rλ P.'))
    add('bandwidth', t('Respuesta RC normalizada', 'Normalized RC response'), f, f.map(f => 1 / Math.sqrt(1 + (f / fc) ** 2)), 'Frequency', 'Hz', 'Normalized magnitude', '1', t('Sólo incluye la carga RC; el tiempo de tránsito no está incluido.', 'Includes only the RC load; transit time is not included.'))
    m('responsivity', t('Responsividad', 'Responsivity'), responsivity, 'A/W'); m('photocurrent', t('Fotocorriente', 'Photocurrent'), photo, 'A'); m('bandwidth', t('Frecuencia de corte RC', 'RC cutoff frequency'), fc, 'Hz')
  } else if (id === 'solar') {
    const photo = p.photo_current * 1e-3, voc = p.ideality * vt * Math.log1p(photo / p.isat), v = linspace(0, voc, count), current = v.map(v => photo - shockley(v, p.isat, p.ideality, vt)), power = current.map((i, index) => i * v[index])
    const mpp = bisect(v => photo + p.isat - p.isat * Math.exp(v / (p.ideality * vt)) * (1 + v / (p.ideality * vt)), 0, voc), impp = photo - shockley(mpp, p.isat, p.ideality, vt), maxPower = mpp * impp, efficiency = maxPower / (p.optical_input * 1e-3)
    add('iv', t('I–V fotovoltaica', 'Photovoltaic I–V'), v, current, 'Voltage', 'V', 'Delivered current', 'A', t('La corriente positiva sale hacia la carga; Voc es el punto sin corriente.', 'Positive current flows out to the load; Voc is the zero-current point.'))
    add('power', t('Potencia entregada', 'Delivered power'), v, power, 'Voltage', 'V', 'Delivered power', 'W', t('El MPP se resuelve por d(VI)/dV = 0, independientemente de la resolución de la gráfica.', 'MPP is solved from d(VI)/dV = 0 independently of plotting resolution.'))
    m('voc', t('Circuito abierto Voc', 'Open circuit Voc'), voc, 'V'); m('vmpp', t('Vmpp', 'Vmpp'), mpp, 'V'); m('impp', t('Impp', 'Impp'), impp, 'A'); m('pmax', t('Potencia máxima', 'Maximum power'), maxPower, 'W'); m('ff', t('Factor de llenado', 'Fill factor'), maxPower / (photo * voc), '1'); m('efficiency', t('Eficiencia', 'Efficiency'), efficiency * 100, '%')
    checks.push(check('open_circuit', t('Corriente en Voc / Isc', 'Current at Voc / Isc'), relative(shockley(voc, p.isat, p.ideality, vt), photo), 1e-10), check('energy', t('Exceso de eficiencia sobre 100%', 'Efficiency excess above 100%'), Math.max(0, efficiency - 1), 1e-12))
    if (efficiency > 1) warn('Pin e Iph son incompatibles: la eficiencia supera 100%. Revise las entradas antes de interpretar.', 'Pin and Iph are incompatible: efficiency exceeds 100%. Review inputs before interpretation.')
  } else if (id === 'npn' || id === 'pnp') {
    const sign = id === 'pnp' ? -1 : 1, af = p.beta / (p.beta + 1), ar = p.beta_reverse / (p.beta_reverse + 1)
    const bjt = (vbe: number, vce: number) => { const forward = p.isat / af * expm1(vbe / vt), reverse = p.isat / ar * expm1((vbe - vce) / vt); let collector = af * forward - reverse; const base = (1 - af) * forward + (1 - ar) * reverse; if (vce > vbe && collector > 0) collector *= 1 + vce / p.early; return { collector: collector * sign, base: base * sign, emitter: -(collector + base) * sign } }
    const vce = linspace(p.start, p.stop, count), values = vce.map(v => bjt(p.vbe, v)), vbe = linspace(0, .8, count), gummel = vbe.map(v => bjt(v, p.stop)), signed = (x: number[]) => x.map(x => x * sign)
    const description = t('Ebers–Moll incluye activa inversa y saturación. Todas las corrientes son positivas entrando al terminal.', 'Ebers–Moll includes reverse active operation and saturation. All terminal currents are positive entering the device.')
    add('collector', t('Salida IC–VCE', 'Output IC–VCE'), signed(vce), values.map(x => x.collector), 'VCE', 'V', 'IC', 'A', description)
    add('base', t('Corriente de base', 'Base current'), signed(vce), values.map(x => x.base), 'VCE', 'V', 'IB', 'A', description)
    add('emitter', t('Corriente de emisor', 'Emitter current'), signed(vce), values.map(x => x.emitter), 'VCE', 'V', 'IE', 'A', description)
    add('gummel_collector', t('Gummel: colector', 'Gummel: collector'), signed(vbe), gummel.map(x => Math.abs(x.collector)), 'VBE', 'V', '|IC|', 'A', t('Compare en escala logarítmica para identificar la zona exponencial; sin modelo de alta inyección.', 'Compare on a log scale to identify the exponential region; no high-injection model.'))
    add('gummel_base', t('Gummel: base', 'Gummel: base'), signed(vbe), gummel.map(x => Math.abs(x.base)), 'VBE', 'V', '|IB|', 'A', t('La separación respecto al colector permite estimar ganancia en activa.', 'Separation from collector current allows active-region gain estimation.'))
    m('beta', t('β directo de entrada', 'Input forward β'), p.beta, '1'); m('ic', t('IC al final', 'Sweep-end IC'), values.at(-1)!.collector, 'A'); m('gm', t('gm aproximado en activa', 'Approximate active-region gm'), Math.abs(values.at(-1)!.collector) / vt, 'S')
    checks.push(check('kcl', t('KCL: residuo máximo normalizado', 'KCL: maximum normalized residual'), Math.max(...values.map(x => Math.abs(x.collector + x.base + x.emitter) / Math.max(Math.abs(x.emitter), 1e-30))), 1e-12))
  } else if (id === 'nmos' || id === 'pmos') {
    const sign = id === 'pmos' ? -1 : 1, cox = EPS_OX / (p.oxide * 1e-7), beta = p.mobility * (300 / temp) ** 1.5 * cox * p.width / p.length, drain = linspace(p.start, p.stop, count), gate = linspace(0, 6, count)
    const signed = (x: number[]) => x.map(x => x * sign), current = (vg: number, vd: number) => mosCurrent(vg, vd, p.threshold, beta, p.lambda, vt)
    add('output', t('Salida ID–VDS', 'Output ID–VDS'), signed(drain), drain.map(v => sign * current(p.gate, v)), 'VDS', 'V', 'ID (into drain)', 'A', t('Modelo de canal largo, con transición subumbral suavizada (n = 1.5) y modulación λ.', 'Long-channel model with smoothed subthreshold transition (n = 1.5) and channel modulation λ.'))
    add('transfer', t('Transferencia ID–VGS', 'Transfer ID–VGS'), signed(gate), gate.map(v => sign * current(v, p.drain)), 'VGS', 'V', 'ID (into drain)', 'A', t('El barrido mantiene VDS fijo; NMOS y PMOS usan corriente entrante al drenador.', 'The sweep holds VDS fixed; NMOS and PMOS use drain-entering current.'))
    add('gm', t('Transconductancia gm', 'Transconductance gm'), signed(gate), gate.map(v => (current(v + 1e-4, p.drain) - current(v - 1e-4, p.drain)) / 2e-4), 'VGS', 'V', 'gm', 'S', t('Derivada central con paso de 0.1 mV. Cerca del límite de región la derivada depende del modelo compacto.', 'Central derivative with 0.1 mV step. Near a region boundary the derivative depends on the compact model.'))
    for (const vg of [.5, 1, 1.5, 2, 3]) add(`output_${vg}`, t(`Salida |VGS| = ${vg} V`, `Output |VGS| = ${vg} V`), signed(drain), drain.map(v => sign * current(vg, v)), 'VDS', 'V', 'ID (into drain)', 'A', t('Familia de curvas con la misma geometría y temperatura.', 'Curve family at fixed geometry and temperature.'))
    m('threshold', t('Umbral con signo', 'Signed threshold'), p.threshold * sign, 'V'); m('cox', t('Cox por unidad de área', 'Cox per unit area'), cox, 'F/cm²'); m('beta', t('β de conducción', 'Conduction β'), beta, 'A/V²'); m('current', t('Corriente de observación', 'Observation current'), sign * current(p.gate, p.drain), 'A')
    if (p.length < 1) warn('La geometría entra en canal corto; este modelo no incluye DIBL, velocidad de saturación ni efectos cuánticos.', 'Geometry enters the short-channel range; this model excludes DIBL, velocity saturation and quantum effects.')
  } else if (id === 'jfet') {
    const idss = p.idss * 1e-3, vg = linspace(-p.pinch, 0, count), vd = linspace(0, p.stop, count)
    const current = (g: number, d: number) => { const overdrive = Math.max(0, p.pinch + Math.min(0, g)); return d < overdrive ? idss / p.pinch ** 2 * (2 * overdrive * d - d * d) : idss * (overdrive / p.pinch) ** 2 }
    add('transfer', t('Transferencia ID–VGS', 'Transfer ID–VGS'), vg, vg.map(v => current(v, p.pinch)), 'VGS', 'V', 'ID', 'A', t('En saturación sigue la parábola de Shockley para JFET; VGS nunca es positivo.', 'In saturation it follows the JFET Shockley parabola; VGS is never positive.'))
    add('output', t('Salida ID–VDS', 'Output ID–VDS'), vd, vd.map(v => current(p.gate, v)), 'VDS', 'V', 'ID', 'A', t('La región óhmica conecta de forma continua con saturación en VDS = VGS − Vp.', 'The ohmic region joins saturation continuously at VDS = VGS − Vp.'))
    m('pinch', t('Tensión de corte Vp', 'Cutoff voltage Vp'), -p.pinch, 'V'); m('idss', t('Corriente IDSS', 'Current IDSS'), idss, 'A'); m('current', t('Corriente de saturación seleccionada', 'Selected saturation current'), current(p.gate, p.stop), 'A')
  } else if (id === 'moscap') {
    const v = linspace(p.start, p.stop, count), cox = EPS_OX / (p.oxide * 1e-7), phi = vt * Math.log(carriers(-p.na, ni).p / ni), cdmax = Math.sqrt(EPS_SI * Q * p.na / (4 * phi)), chfmin = cox * cdmax / (cox + cdmax)
    const psi = v.map(v => bisect(psi => p.flatband + psi - mosCharge(psi, p.na, temp) / cox - v, -3, 3)), charges = psi.map(psi => mosCharge(psi, p.na, temp)), cs = psi.map(psi => Math.abs((mosCharge(psi + 1e-5, p.na, temp) - mosCharge(psi - 1e-5, p.na, temp)) / 2e-5)), cl = cs.map(c => cox * c / (cox + c) * p.area * 1e-8 * 1e12), hf = psi.map((psi, i) => psi > 2 * phi ? chfmin * p.area * 1e-8 * 1e12 : cl[i])
    add('capacitance_lf', t('C–V cuasiestática / LF', 'Quasi-static / LF C–V'), v, cl, 'Gate voltage', 'V', 'Capacitance', 'pF', t('Se resuelve Poisson–Boltzmann superficial por bisección; todos los portadores siguen la señal lenta.', 'Surface Poisson–Boltzmann is solved by bisection; all carriers follow the slow signal.'))
    add('capacitance_hf', t('C–V HF aproximada', 'Approximate HF C–V'), v, hf, 'Gate voltage', 'V', 'Capacitance', 'pF', t('En inversión se mantiene la capacitancia de agotamiento máximo: una aproximación, sin frecuencia explícita.', 'In inversion maximum-depletion capacitance is held: an approximation without an explicit frequency.'))
    add('surface', t('Potencial superficial ψs', 'Surface potential ψs'), v, psi, 'Gate voltage', 'V', 'Surface potential', 'V', t('La tensión se reparte entre potencial superficial y caída de óxido.', 'Voltage divides between surface potential and oxide voltage drop.'))
    add('charge', t('Carga superficial Qs', 'Surface charge Qs'), v, charges, 'Gate voltage', 'V', 'Surface charge', 'C/cm²', t('Acumulación de huecos: Qs > 0; agotamiento/inversión: Qs < 0.', 'Hole accumulation: Qs > 0; depletion/inversion: Qs < 0.'))
    m('cox', t('Capacitancia de óxido', 'Oxide capacitance'), cox * p.area * 1e-8 * 1e12, 'pF'); m('threshold', t('Vth ideal', 'Ideal Vth'), p.flatband + 2 * phi + Math.sqrt(4 * EPS_SI * Q * p.na * phi) / cox, 'V'); m('phi', t('Potencial de Fermi |φF|', 'Fermi potential |φF|'), phi, 'V')
    checks.push(check('gate_balance', t('Balance Vg: residuo máximo', 'Vg balance: maximum residual'), Math.max(...v.map((vg, i) => Math.abs(p.flatband + psi[i] - charges[i] / cox - vg))), 1e-8, 'V'))
    if (p.na < 10 * ni) warn('Sustrato cercano a intrínseco: la aproximación HF de agotamiento máximo pierde precisión.', 'Near-intrinsic substrate: HF maximum-depletion approximation loses accuracy.')
  } else if (id === 'igbt') {
    const v = linspace(0, p.stop, count), drive = clamp((p.gate - p.threshold) / 5, 0, 1), current = v.map(v => drive * Math.max(0, v - p.offset) / p.resistance)
    add('output', t('Salida equivalente IC–VCE', 'Equivalent output IC–VCE'), v, current, 'VCE', 'V', 'IC', 'A', t('Equivalente estático: la puerta habilita una rama con caída fija y resistencia. No es TCAD del IGBT.', 'Static equivalent: the gate enables a fixed-drop resistive branch. This is not IGBT TCAD.'))
    add('power', t('Pérdidas de conducción', 'Conduction losses'), v, current.map((i, index) => i * v[index]), 'VCE', 'V', 'Conduction power', 'W', t('Sólo pérdidas instantáneas de conducción; sin pérdidas de conmutación ni límites de seguridad.', 'Instantaneous conduction losses only; no switching losses or safety limits.'))
    m('drive', t('Factor de habilitación de puerta', 'Gate enabling factor'), drive, '1'); m('current', t('Corriente al final', 'Sweep-end current'), current.at(-1)!, 'A')
  } else if (id === 'scr') {
    if (p.trigger >= p.supply) throw new Error('El pulso debe ocurrir antes de la tensión máxima / Trigger must occur before maximum supply')
    const v = linspace(0, p.supply, count), up: number[] = [], down: number[] = [], onVoltage = 1, hold = p.holding * 1e-3
    let on = false
    for (let index = 0; index < v.length; index++) { const voltage = v[index], possible = Math.max(0, voltage - onVoltage) / p.load; const pulse = voltage >= p.trigger && (index === 0 || v[index - 1] < p.trigger); if (pulse && possible > hold) on = true; if (possible <= hold) on = false; up.push(on ? possible : 0) }
    on = up.at(-1)! > hold
    for (const voltage of [...v].reverse()) { const possible = Math.max(0, voltage - onVoltage) / p.load; if (possible <= hold) on = false; down.push(on ? possible : 0) }
    add('up', t('Rampa ascendente + pulso', 'Rising ramp + pulse'), v, up, 'Supply voltage', 'V', 'Load current', 'A', t('El pulso ocurre al alcanzar la tensión seleccionada. Si no se supera IH, no se enclava.', 'The pulse occurs at the selected supply voltage. Without exceeding IH, it does not latch.'))
    add('down', t('Rampa descendente sin pulso', 'Falling ramp without pulse'), v, down.reverse(), 'Supply voltage', 'V', 'Load current', 'A', t('El estado inicial de bajada es el alcanzado en la subida; se apaga al caer por debajo de IH.', 'Falling-ramp initial state is the state reached during the rising ramp; it switches off below IH.'))
    m('holding', t('Corriente de mantenimiento', 'Holding current'), hold, 'A'); m('off_supply', t('Alimentación de apagado ideal', 'Ideal turn-off supply'), onVoltage + hold * p.load, 'V')
  } else if (id === 'cmos') {
    const vin = linspace(0, p.supply, count), beta = p.beta * 1e-3
    const inmos = (g: number, d: number) => mosCurrent(g, d, p.threshold, beta, .02, vt), ipmos = (g: number, d: number) => mosCurrent(p.supply - g, p.supply - d, p.threshold, beta * p.ratio, .02, vt)
    const out = vin.map(v => bisect(d => inmos(v, d) - ipmos(v, d), 0, p.supply)), current = vin.map((v, i) => inmos(v, out[i]))
    add('transfer', t('Transferencia Vout–Vin', 'Transfer Vout–Vin'), vin, out, 'Input voltage', 'V', 'Output voltage', 'V', t('Se igualan las corrientes NMOS y PMOS. No se usa una sigmoide prefijada.', 'NMOS and PMOS currents are balanced. No predefined sigmoid is used.'))
    add('current', t('Corriente de alimentación', 'Supply current'), vin, current, 'Input voltage', 'V', 'Supply current', 'A', t('El solapamiento de conducción produce corriente estática durante la transición.', 'Conduction overlap produces static current during the transition.'))
    add('gain', t('Ganancia de tensión', 'Voltage gain'), vin, derivative(vin, out), 'Input voltage', 'V', 'dVout/dVin', '1', t('La derivada numérica depende del muestreo; refine cerca de la transición.', 'Numerical derivative depends on sampling; refine near the transition.'))
    const switching = bisect(v => inmos(v, v) - ipmos(v, v), 0, p.supply)
    m('switching', t('Punto de conmutación', 'Switching point'), switching, 'V'); m('current', t('Corriente estática máxima', 'Maximum static current'), Math.max(...current), 'A'); m('gain', t('|Ganancia| máxima muestreada', 'Maximum sampled |gain|'), Math.max(...derivative(vin, out).map(Math.abs)), '1')
    checks.push(check('kcl', t('Balance In − Ip máximo', 'Maximum In − Ip balance'), Math.max(...vin.map((v, i) => Math.abs(inmos(v, out[i]) - ipmos(v, out[i])))), 1e-10, 'A'))
  } else if (id === 'rc') {
    const cap = p.capacitance * 1e-9, tau = p.resistance * cap, time = linspace(0, 6 * tau, count), fc = 1 / (2 * Math.PI * tau), f = logspace(fc / 100, fc * 100, count)
    add('charging', t('Carga del capacitor', 'Capacitor charging'), time, time.map(t => p.supply * -Math.expm1(-t / tau)), 'Time', 's', 'Capacitor voltage', 'V', t('En τ se alcanza 1 − 1/e ≈ 63.2% de la tensión final.', 'At τ the voltage reaches 1 − 1/e ≈ 63.2% of its final value.'))
    add('current', t('Corriente de carga', 'Charging current'), time, time.map(t => p.supply / p.resistance * Math.exp(-t / tau)), 'Time', 's', 'Charging current', 'A', t('La corriente disminuye a medida que se carga el capacitor.', 'Current decreases as the capacitor charges.'))
    add('bode', t('Bode: magnitud', 'Bode: magnitude'), f, f.map(f => -10 * Math.log10(1 + (f / fc) ** 2)), 'Frequency', 'Hz', 'Gain', 'dB', t('Filtro pasabajo: −3.01 dB en fc y pendiente asintótica −20 dB/década.', 'Low-pass filter: −3.01 dB at fc and asymptotic −20 dB/decade slope.'))
    add('phase', t('Bode: fase', 'Bode: phase'), f, f.map(f => -Math.atan(f / fc) * 180 / Math.PI), 'Frequency', 'Hz', 'Phase', '°', t('La fase es −45° en fc.', 'Phase is −45° at fc.'))
    m('tau', t('Constante de tiempo τ', 'Time constant τ'), tau, 's'); m('cutoff', t('Frecuencia de corte', 'Cutoff frequency'), fc, 'Hz'); m('energy', t('Energía final almacenada', 'Final stored energy'), cap * p.supply ** 2 / 2, 'J')
  } else if (id === 'rlc') {
    const l = p.inductance * 1e-3, cap = p.capacitance * 1e-9, f0 = 1 / (2 * Math.PI * Math.sqrt(l * cap)), f = logspace(f0 / 10, f0 * 10, count), reactance = f.map(f => 2 * Math.PI * f * l - 1 / (2 * Math.PI * f * cap)), quality = Math.sqrt(l / cap) / p.resistance
    add('current', t('Corriente en frecuencia', 'Frequency-domain current'), f, reactance.map(x => p.supply / Math.hypot(p.resistance, x)), 'Frequency', 'Hz', 'Current amplitude', 'A', t('En f0 se cancelan reactancias y la amplitud tiende a V/R.', 'At f0 reactances cancel and amplitude approaches V/R.'))
    add('phase', t('Fase de corriente', 'Current phase'), f, reactance.map(x => -Math.atan2(x, p.resistance) * 180 / Math.PI), 'Frequency', 'Hz', 'Current phase', '°', t('La fase pasa de capacitiva a inductiva y vale cero en resonancia.', 'Phase changes from capacitive to inductive and is zero at resonance.'))
    m('frequency', t('Frecuencia resonante f0', 'Resonant frequency f0'), f0, 'Hz'); m('quality', t('Factor Q', 'Quality factor Q'), quality, '1'); m('bandwidth', t('Ancho de banda f0/Q', 'Bandwidth f0/Q'), f0 / quality, 'Hz'); m('current', t('Corriente resonante ideal', 'Ideal resonant current'), p.supply / p.resistance, 'A')
    if (quality > 20) warn('Q alto: el muestreo puede no resolver el pico estrecho. El valor resonante de la métrica se calcula analíticamente.', 'High Q: sampling may not resolve the narrow peak. The resonant metric is calculated analytically.')
  } else if (id === 'rectifier') {
    const duration = 6 / p.frequency, time = linspace(0, duration, count), input = time.map(t => p.supply * Math.sin(2 * Math.PI * p.frequency * t)), rectified = input.map(v => Math.max(0, Math.abs(v) - 2 * p.drop)), filtered: number[] = [], dt = duration / (count - 1), decay = Math.exp(-dt / (p.resistance * p.capacitance * 1e-6))
    let vc = 0
    for (const value of rectified) { vc = Math.max(value, vc * decay); filtered.push(vc) }
    add('input', t('Entrada AC', 'AC input'), time, input, 'Time', 's', 'Input voltage', 'V', t('Se muestran seis períodos de entrada, incluido el arranque.', 'Six input periods are displayed, including startup.'))
    add('rectified', t('Rectificación sin filtro', 'Unfiltered rectification'), time, rectified, 'Time', 's', 'Rectified voltage', 'V', t('Cada camino del puente tiene dos caídas de diodo.', 'Each bridge path includes two diode drops.'))
    add('filtered', t('Salida con capacitor', 'Capacitor-filtered output'), time, filtered, 'Time', 's', 'Output voltage', 'V', t('La descarga entre muestras es exponencial. El pico y el rizado dependen de la resolución temporal.', 'Discharge between samples is exponential. Peak and ripple depend on time resolution.'))
    const last = filtered.filter((_, i) => time[i] >= 5 / p.frequency)
    m('ripple', t('Rizado pico a pico, último período', 'Peak-to-peak ripple, final period'), Math.max(...last) - Math.min(...last), 'V'); m('average', t('Promedio muestreado, último período', 'Sample mean, final period'), last.reduce((sum, v) => sum + v, 0) / last.length, 'V'); m('step', t('Paso temporal', 'Time step'), dt, 's')
    if (count < 501) warn('Para medir rizado use 501 o 1001 puntos y compare el resultado refinado.', 'Use 501 or 1001 points to measure ripple and compare the refined result.')
  } else if (id === 'recombination') {
    const equilibrium = carriers(p.nd, ni), tau = p.tau * 1e-9, rate = (excess: number) => excess * (equilibrium.n + equilibrium.p + excess) / (tau * (equilibrium.n + equilibrium.p + 2 * excess + 2 * ni)), time = linspace(0, 6 * tau, count), exact: number[] = [p.excess], dt = time[1]
    for (let i = 1; i < count; i++) { const n = exact[i - 1], k1 = -rate(n), k2 = -rate(n + dt * k1 / 2), k3 = -rate(n + dt * k2 / 2), k4 = -rate(n + dt * k3); exact.push(Math.max(0, n + dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6)) }
    const excess = logspace(1e8, Math.max(1e18, p.excess * 2), count)
    add('decay', t('Decaimiento: límite de baja inyección', 'Decay: low-injection limit'), time.map(t => t * 1e9), time.map(t => p.excess * Math.exp(-t / tau)), 'Time', 'ns', 'Excess carriers', 'cm⁻³', t('Referencia exponencial Δn0 exp(−t/τ); use sólo si Δn es mucho menor que ND.', 'Exponential reference Δn0 exp(−t/τ); use only when excess is much smaller than ND.'))
    add('srh_decay', t('Decaimiento SRH integrado', 'Integrated SRH decay'), time.map(t => t * 1e9), exact, 'Time', 'ns', 'Excess carriers', 'cm⁻³', t('Integra dΔn/dt = −U con RK4 uniforme; incluye el cambio de vida efectiva con inyección.', 'Integrates dΔn/dt = −U using uniform RK4; includes injection-dependent effective lifetime.'))
    add('rate', t('Tasa SRH', 'SRH rate'), excess, excess.map(rate), 'Excess carriers', 'cm⁻³', 'Recombination rate', 'cm⁻³/s', t('Trampa a mitad de banda con vidas de electrones/huecos iguales.', 'Mid-gap trap with equal electron/hole lifetimes.'))
    add('lifetime', t('Vida efectiva Δn/U', 'Effective lifetime Δn/U'), excess, excess.map(x => x / rate(x) * 1e9), 'Excess carriers', 'cm⁻³', 'Effective lifetime', 'ns', t('En alta inyección este modelo tiende a 2τ.', 'Under high injection this model approaches 2τ.'))
    m('tau', t('Vida de entrada τn = τp', 'Input lifetime τn = τp'), p.tau, 'ns'); m('diffusion_length', t('Longitud de difusión electrónica', 'Electron diffusion length'), Math.sqrt(mobilityN(temp) * vt * tau) * 1e4, 'µm'); m('injection', t('Inyección inicial Δn/ND', 'Initial injection Δn/ND'), p.excess / p.nd, '1')
    checks.push(check('equilibrium_rate', t('Recombinación neta en equilibrio', 'Net equilibrium recombination'), rate(0), 1e-12, 'cm⁻³/s'))
    if (p.excess > .1 * p.nd) warn('Alta inyección: use la curva SRH integrada; el decaimiento exponencial es sólo una referencia.', 'High injection: use integrated SRH decay; exponential decay is only a reference.')
  } else if (id === 'diffusion') {
    const x = linspace(0, p.depth, count), dt = p.diffusivity * p.time, width = Math.sqrt(dt), pre = x.map(x => p.surface * (1 - erf(x / (2 * width)))), drive = x.map(x => p.dose / (Math.sqrt(Math.PI * dt) * 1e-4) * Math.exp(-x * x / (4 * dt))), visible = integral(x.map(x => x * 1e-4), drive), expected = p.dose * erf(p.depth / (2 * width))
    add('predeposition', t('Predeposición: fuente constante', 'Predeposition: constant source'), x, pre, 'Depth', 'µm', 'Dopant concentration', 'cm⁻³', t('La superficie mantiene Cs; la dosis total crece con √t.', 'The surface holds Cs; total dose grows as √t.'))
    add('drive_in', t('Redistribución: dosis finita', 'Drive-in: finite dose'), x, drive, 'Depth', 'µm', 'Dopant concentration', 'cm⁻³', t('Q se conserva en el medio semiinfinito. El área visible puede ser menor por la ventana de profundidad.', 'Q is conserved in the semi-infinite medium. Visible area can be smaller because of the depth window.'))
    const times = linspace(1, p.time, count)
    add('spread', t('Longitud característica 2√Dt', 'Characteristic length 2√Dt'), times, times.map(t => 2 * Math.sqrt(p.diffusivity * t)), 'Time', 's', 'Diffusion length', 'µm', t('La longitud crece con la raíz cuadrada del tiempo para D constante.', 'Length grows as the square root of time at constant D.'))
    m('length', t('Longitud característica', 'Characteristic length'), 2 * width, 'µm'); m('visible_dose', t('Dosis finita en ventana visible', 'Finite dose in visible window'), visible, 'cm⁻²'); m('coverage', t('Fracción de dosis visible (analítica)', 'Visible dose fraction (analytic)'), expected / p.dose * 100, '%'); m('pre_dose', t('Dosis total de predeposición', 'Total predeposition dose'), 2 * p.surface * width * 1e-4 / Math.sqrt(Math.PI), 'cm⁻²')
    checks.push(check('dose_integral', t('Integral de dosis frente a solución: error relativo', 'Dose integral versus solution: relative error'), relative(visible, expected), .01))
    if (expected / p.dose < .95) warn('La ventana muestra menos de 95% de la dosis. Aumente la profundidad para integrar el perfil.', 'The window shows less than 95% of the dose. Increase depth to integrate the profile.')
  } else if (id === 'implantation') {
    const sigma = Math.sqrt(p.straggle ** 2 + 2 * p.diffusivity * p.time), x = linspace(0, p.depth, count)
    const gaussian = (x: number, s: number) => p.dose / (Math.sqrt(2 * Math.PI) * s * 1e-4) * Math.exp(-((x - p.range) ** 2) / (2 * s * s)), original = x.map(x => gaussian(x, p.straggle)), annealed = x.map(x => gaussian(x, sigma)), fraction = (1 + erf(p.range / (Math.sqrt(2) * sigma))) / 2, expected = p.dose / 2 * (erf((p.depth - p.range) / (Math.sqrt(2) * sigma)) + erf(p.range / (Math.sqrt(2) * sigma))), dose = integral(x.map(x => x * 1e-4), annealed)
    add('implanted', t('Perfil implantado', 'Implanted profile'), x, original, 'Depth', 'µm', 'Dopant concentration', 'cm⁻³', t('Gaussiana normalizada en toda la recta; sólo se muestra profundidad no negativa.', 'Gaussian normalized over the full line; only nonnegative depth is displayed.'))
    add('annealed', t('Perfil después del recocido', 'Post-anneal profile'), x, annealed, 'Depth', 'µm', 'Dopant concentration', 'cm⁻³', t('La varianza aumenta en 2Dt. El modelo de línea infinita permite masa en x < 0; se reporta explícitamente.', 'Variance increases by 2Dt. The infinite-line model allows mass at x < 0; it is explicitly reported.'))
    m('sigma', t('Dispersión después del recocido', 'Post-anneal spread'), sigma, 'µm'); m('dose', t('Dosis integrada visible', 'Integrated visible dose'), dose, 'cm⁻²'); m('substrate', t('Dosis del modelo dentro de x ≥ 0', 'Model dose within x ≥ 0'), fraction * 100, '%')
    checks.push(check('dose_integral', t('Integral visible frente a gaussiana: error relativo', 'Visible integral versus Gaussian: relative error'), relative(dose, expected), .01))
    if (fraction < .95) warn('El modelo gaussiano de línea infinita sitúa parte de la dosis fuera del sustrato. Para conservación en una superficie real se requiere otra condición de frontera.', 'The infinite-line Gaussian places some dose outside the substrate. Real-surface conservation requires a different boundary condition.')
  } else if (id === 'oxidation') {
    const x0 = p.initial / 1000, shift = (x0 * x0 + p.linear * x0) / p.parabolic, time = linspace(0, p.time, count), oxide = time.map(t => 2 * p.parabolic * (t + shift) / (Math.sqrt(p.linear ** 2 + 4 * p.parabolic * (t + shift)) + p.linear))
    add('oxide', t('Crecimiento de SiO₂', 'SiO₂ growth'), time, oxide.map(x => x * 1000), 'Time', 'min', 'Oxide thickness', 'nm', t('Solución de Deal–Grove con óxido inicial y constantes A/B del proceso.', 'Deal–Grove solution with initial oxide and process A/B constants.'))
    add('silicon_consumed', t('Silicio consumido', 'Consumed silicon'), time, oxide.map(x => .44 * (x - x0) * 1000), 'Time', 'min', 'Additional Si consumed', 'nm', t('Se reporta consumo adicional respecto al óxido inicial, con razón volumétrica aproximada 0.44.', 'Additional consumption relative to initial oxide is reported, using approximate volume ratio 0.44.'))
    add('linearized', t('Linealización x² + Ax', 'x² + Ax linearization'), time, oxide.map(x => x * x + p.linear * x), 'Time', 'min', 'x² + Ax', 'µm²', t('La pendiente es B; el intercepto depende del óxido inicial.', 'Slope is B; intercept depends on initial oxide.'))
    m('oxide', t('Óxido final', 'Final oxide'), oxide.at(-1)! * 1000, 'nm'); m('silicon', t('Silicio consumido adicional', 'Additional silicon consumed'), .44 * (oxide.at(-1)! - x0) * 1000, 'nm')
    checks.push(check('deal_grove', t('Residuo máximo de Deal–Grove', 'Maximum Deal–Grove residual'), Math.max(...oxide.map((x, i) => Math.abs(x * x + p.linear * x - p.parabolic * (time[i] + shift)))), 1e-10, 'µm²'))
    if (p.initial < 20) warn('Parte del recorrido es ultradelgada: Deal–Grove es una referencia y puede desviarse de mediciones reales.', 'Part of the trajectory is ultrathin: Deal–Grove is a reference and may deviate from real measurements.')
  } else if (id === 'lithography') {
    const na = linspace(.1, 1.35, count), x = linspace(0, 2 * p.pitch, count), cd = p.k1 * p.wavelength / p.numerical_aperture, dof = p.k2 * p.wavelength / p.numerical_aperture ** 2
    add('resolution', t('Resolución frente a NA', 'Resolution versus NA'), na, na.map(na => p.k1 * p.wavelength / na), 'Numerical aperture', '1', 'Minimum CD', 'nm', t('Criterio de Rayleigh con k1 fijo; no demuestra que un proceso real imprima ese tamaño.', 'Rayleigh criterion at fixed k1; does not demonstrate real-process printability.'))
    add('focus', t('Profundidad de foco frente a NA', 'Depth of focus versus NA'), na, na.map(na => p.k2 * p.wavelength / na ** 2), 'Numerical aperture', '1', 'Depth of focus', 'nm', t('Mayor NA mejora CD pero reduce la profundidad de foco.', 'Higher NA improves CD but reduces depth of focus.'))
    add('image', t('Imagen periódica conceptual', 'Conceptual periodic image'), x, x.map(x => 1 + p.contrast * Math.cos(2 * Math.PI * x / p.pitch)), 'Position', 'nm', 'Normalized intensity', '1', t('Intensidad sinusoidal prescrita. No simula difracción, resist, iluminación parcial ni focus-exposure matrix.', 'Prescribed sinusoidal intensity. Does not simulate diffraction, resist, partial coherence or focus-exposure matrix.'))
    m('resolution', t('CD mínimo estimado', 'Estimated minimum CD'), cd, 'nm'); m('focus', t('Profundidad de foco estimada', 'Estimated depth of focus'), dof, 'nm'); m('half_pitch', t('Medio paso propuesto', 'Proposed half pitch'), p.pitch / 2, 'nm')
    if (p.pitch / 2 < cd) warn('El medio paso propuesto está por debajo del criterio de resolución. La imagen dibujada sigue siendo conceptual.', 'Proposed half pitch is below the resolution criterion. The drawn image remains conceptual.')
  } else if (id === 'etching') {
    const time = linspace(0, p.time, count), lifetime = p.mask * p.selectivity / p.rate, active = time.map(t => Math.min(t, lifetime)), depth = active.map(t => p.rate * t)
    add('depth', t('Profundidad de grabado protegido', 'Protected etch depth'), time, depth, 'Time', 'min', 'Etch depth', 'nm', t('El modelo del patrón deja de ser válido al agotarse la máscara; se detiene allí.', 'The pattern model becomes invalid when the mask is exhausted; it stops there.'))
    add('mask', t('Máscara restante', 'Remaining mask'), time, active.map(t => Math.max(0, p.mask - p.rate / p.selectivity * t)), 'Time', 'min', 'Mask thickness', 'nm', t('El consumo depende de la selectividad del material frente a la máscara.', 'Consumption depends on material-to-mask selectivity.'))
    add('undercut', t('Socavado lateral', 'Lateral undercut'), time, depth.map(d => d * p.anisotropy), 'Time', 'min', 'Undercut', 'nm', t('Fracción lateral prescrita: 0 representa idealmente anisótropo y 1 isotrópico.', 'Prescribed lateral fraction: 0 is ideally anisotropic and 1 isotropic.'))
    m('lifetime', t('Tiempo hasta agotar máscara', 'Time to mask exhaustion'), lifetime, 'min'); m('depth', t('Profundidad protegida final', 'Final protected depth'), depth.at(-1)!, 'nm')
    checks.push(check('mask_valid', t('Tiempo fuera del régimen protegido', 'Time outside protected regime'), Math.max(0, p.time - lifetime), 0, 'min'))
    if (p.time >= lifetime) warn('Máscara agotada: se requiere un modelo de grabado sin protección para continuar el proceso.', 'Mask exhausted: continuing the process requires an unprotected-etch model.')
  } else if (id === 'deposition') {
    const time = linspace(0, p.time, count), thickness = time.map(t => t * p.rate), radial = linspace(0, 1, count), h0 = p.time * p.rate, film = radial.map(r => h0 * (1 - p.uniformity / 100 * r * r)), sheet = film.map(h => p.resistivity * 1e-6 / (h * 1e-7))
    add('thickness', t('Espesor de película', 'Film thickness'), time, thickness, 'Time', 'min', 'Thickness', 'nm', t('Crecimiento a velocidad constante; no incluye incubación ni nucleación.', 'Constant growth rate; no incubation or nucleation.'))
    add('radial', t('Espesor radial', 'Radial thickness'), radial, film, 'Normalized wafer radius', '1', 'Thickness', 'nm', t('Perfil parabólico prescrito con disminución hacia el borde.', 'Prescribed parabolic profile decreasing toward the edge.'))
    add('sheet_radial', t('Resistencia de hoja radial', 'Radial sheet resistance'), radial, sheet, 'Normalized wafer radius', '1', 'Sheet resistance', 'Ω/□', t('Rs = ρ/h con conversión explícita de nm a cm; no se incluye resistividad dependiente del espesor.', 'Rs = ρ/h with explicit nm-to-cm conversion; thickness-dependent resistivity is not included.'))
    m('thickness', t('Espesor central', 'Center thickness'), h0, 'nm'); m('sheet', t('Resistencia de hoja central', 'Center sheet resistance'), sheet[0], 'Ω/□'); m('edge', t('Resistencia de hoja en borde', 'Edge sheet resistance'), sheet.at(-1)!, 'Ω/□')
  } else if (id === 'yield') {
    const area = linspace(0, p.die_area, count), poisson = area.map(a => Math.exp(-p.defects * a / 100)), clustered = area.map(a => (1 + p.defects * a / (100 * p.clustering)) ** -p.clustering)
    add('poisson', t('Rendimiento Poisson', 'Poisson yield'), area, poisson.map(y => y * 100), 'Die area', 'mm²', 'Yield', '%', t('Defectos independientes: probabilidad de cero defectos letales en el área.', 'Independent defects: probability of zero killer defects within the area.'))
    add('clustered', t('Rendimiento con agrupamiento', 'Clustered yield'), area, clustered.map(y => y * 100), 'Die area', 'mm²', 'Yield', '%', t('Modelo binomial negativo; cuando α crece se aproxima a Poisson.', 'Negative-binomial model; increasing α approaches Poisson.'))
    m('poisson', t('Rendimiento Poisson al área máxima', 'Poisson yield at maximum area'), poisson.at(-1)! * 100, '%'); m('clustered', t('Rendimiento agrupado al área máxima', 'Clustered yield at maximum area'), clustered.at(-1)! * 100, '%'); m('defects', t('Defectos esperados por chip', 'Expected defects per die'), p.defects * p.die_area / 100, '1')
  }

  if (!curves.length) throw new Error(`No implemented model: ${id}`)
  const finite = [...curves.flatMap(s => [...s.x, ...s.y]), ...metrics.map(m => m.value)].every(Number.isFinite)
  checks.unshift(check('finite', t('Datos y métricas finitos', 'Finite data and metrics'), finite ? 0 : 1, 0))
  if (!finite) throw new Error('El modelo generó valores no finitos / Model generated nonfinite values')
  return result
}

export function randomGenerator(seed: number) { let state = seed >>> 0; return () => { state = (1664525 * state + 1013904223) >>> 0; return (state + .5) / 4294967296 } }
export function runStudy(config: Config, request: StudyRequest): Study {
  if (request.type !== 'sweep' && request.type !== 'montecarlo') throw new Error('Tipo de estudio desconocido / Unknown study type')
  const spec = getDevice(config.device).parameters.find(p => p.key === request.parameter)
  if (!spec) throw new Error('Parámetro desconocido / Unknown parameter')
  if (!Number.isFinite(request.variation) || request.variation <= 0 || request.variation > 50 || !Number.isInteger(request.samples) || request.samples < 3 || request.samples > 40 || !Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) throw new Error('Estudio: variación 0–50%, 3–40 muestras y semilla uint32 / Study: 0–50% variation, 3–40 samples and uint32 seed')
  const nominal = normalizeConfig(config), center = nominal.parameters[spec.key], random = randomGenerator(request.seed), samples = request.type === 'sweep' ? 5 : request.samples
  if (center === 0) throw new Error('Elija un parámetro nominal distinto de cero para estudiar variación porcentual / Choose a nonzero nominal parameter for percentage variation')
  const gaussian = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random())
  const values = request.type === 'sweep' ? [-1, -.5, 0, .5, 1].map(x => center * (1 + x * request.variation / 100)) : Array.from({ length: samples }, () => center + Math.abs(center) * request.variation / 100 * gaussian())
  // Never silently clip samples: clipping alters the requested distribution.
  if (values.some(value => value < spec.min || value > spec.max)) throw new Error(`La distribución sale del rango de ${spec.label.es}; reduzca la variación o cambie el nominal / Distribution exceeds the parameter range; reduce variation or change nominal`)
  return { request: { ...request }, runs: values.map((value, i) => ({ label: request.type === 'sweep' ? `${spec.key} = ${value.toPrecision(4)}` : `MC ${i + 1} · ${value.toPrecision(4)}`, result: simulateDevice({ ...nominal, parameters: { ...nominal.parameters, [spec.key]: value } }) })) }
}
