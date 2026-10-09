import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const urls = new Map()
const compiled = await mkdtemp(`${tmpdir()}/opensemilab-physics-tests-`)
after(() => rm(compiled, { recursive: true, force: true }))
async function moduleUrl(path) {
  if (urls.has(path)) return urls.get(path)
  let source = stripTypeScriptTypes(await readFile(new URL(`../src/deviceLab/${path}.ts`, import.meta.url), 'utf8'))
  for (const match of [...source.matchAll(/from\s+(['"])([^'"]+)\1/g)]) {
    if (!match[2].startsWith('./')) throw new Error(`Unexpected runtime dependency: ${match[2]}`)
    source = source.replace(match[0], `from '${await moduleUrl(match[2].slice(2))}'`)
  }
  const filename = `${compiled}/${path}.mjs`
  await writeFile(filename, source)
  const url = pathToFileURL(filename).href
  urls.set(path, url); return url
}
const catalogue = await import(await moduleUrl('catalogue'))
const physics = await import(await moduleUrl('physics'))
const science = await import(await moduleUrl('scientific'))
const { DEVICES, GUIDES, defaultConfig } = catalogue
const { simulateDevice, runStudy, junction, Q, EPS_SI, thermalVoltage } = physics
const run = (id, parameters = {}, points = 201) => simulateDevice({ ...defaultConfig(id), parameters: { ...defaultConfig(id).parameters, ...parameters }, points })
const curve = (r, id) => r.series.find(s => s.name === id)
const metric = (r, id) => r.metrics.find(m => m.id === id).value
const close = (actual, expected, relative = 1e-8) => assert.ok(Math.abs(actual - expected) <= Math.max(Math.abs(expected) * relative, 1e-15), `${actual} ≈ ${expected}`)

test('every advertised device and experiment has executable finite data with units', () => {
  assert.equal(new Set(DEVICES.map(d => d.id)).size, 33)
  for (const device of DEVICES) {
    const result = run(device.id)
    assert.ok(result.series.length >= 1, device.id)
    for (const s of result.series) { assert.equal(s.x.length, s.y.length); assert.ok(s.x.length > 1); assert.ok([...s.x, ...s.y].every(Number.isFinite), device.id); assert.ok(s.x_unit && s.y_unit && s.explanation.es) }
    assert.ok(result.checks.every(c => c.passed), `${device.id}: ${JSON.stringify(result.checks)}`)
    assert.ok(device.assumptions.length && device.references.length)
  }
  for (const guide of GUIDES) { const r = run(guide.device, guide.parameters); if (guide.series) assert.ok(curve(r, guide.series), guide.id); assert.ok(guide.steps.length >= 4 && guide.expected.es) }
})

test('silicon equilibrium satisfies charge neutrality and mass action even for strong compensation', () => {
  for (const doping of [-1e19, -1e10, 0, 1e10, 1e19]) {
    const { n, p } = physics.carriers(doping, 1e10)
    close(n * p, 1e20); close(n - p, doping)
  }
  close(thermalVoltage(300), .0258519997864355)
  close(physics.intrinsic(300), 1e10)
  assert.ok(physics.intrinsic(400) > physics.intrinsic(300))
})

test('abrupt PN baseline reproduces 0.714 V and 0.430 µm and asymmetric charge balance', () => {
  const j = junction(1e16, 1e16, 300)
  close(j.vbi, .7143171519879805, 1e-5)
  close(j.width * 1e4, .4298, 1e-4)
  close(j.field, 3.3239e4, 1e-4)
  assert.ok(junction(1e16, 1e16, 300, -2).width > j.width)
  const asym = junction(1e17, 1e15, 300)
  close(asym.xn / asym.xp, 100)
  close(1e17 * asym.xp, 1e15 * asym.xn)
  const pin = junction(1e16, 1e16, 300, -1, 2)
  close(Q * 1e16 * (pin.xp ** 2 + pin.xn ** 2) / (2 * EPS_SI) + pin.field * pin.wi, pin.barrier)
  assert.ok(pin.width > 2e-4)
})

test('PN bands, carrier product and electric-field sign agree with equilibrium electrostatics', () => {
  const result = run('pn'), ec = curve(result, 'conduction_band'), ev = curve(result, 'valence_band'), n = curve(result, 'electrons'), p = curve(result, 'holes')
  ec.y.forEach((value, i) => { close(value - ev.y[i], physics.bandgap(300)); close(n.y[i] * p.y[i], 1e20) })
  assert.ok(curve(result, 'electric_field').y.every(e => e <= 1e-10))
})

test('compact diode models show rectification, breakdown and negative differential conductance', () => {
  const pn = curve(run('pn'), 'iv'); assert.ok(pn.y.at(-1) > 1e-3); close(pn.y[0], -1e-12, 1e-7)
  const zener = curve(run('zener'), 'iv'); close(zener.y[0], (-8 + 5.1) / 20 - 1e-12)
  assert.ok(curve(run('tunnel'), 'conductance').y.some(v => v < 0))
  const cap = curve(run('varactor'), 'capacitance'); assert.ok(cap.y[0] > cap.y.at(-1))
  const inv = curve(run('varactor'), 'inverse_capacitance'); assert.ok(science.linearFit(inv.x, inv.y).r2 > .99999999)
  // Large exponent values must follow the analytic law, not a hidden ceiling.
  close(curve(run('pn', { stop: 2.5 }), 'iv').y.at(-1), 1e-12 * Math.expm1(2.5 / thermalVoltage(300)))
  assert.throws(() => run('pn', { stop: 20 }), /Exponente/)
  assert.ok(metric(run('schottky', { temperature: 350 }), 'isat') > metric(run('schottky'), 'isat'))
})

test('optical devices respect photon conversion and flag inconsistent energy inputs', () => {
  const led = run('led'); close(metric(led, 'wavelength'), 652.548, 1e-5)
  const photo = run('photodiode'); close(metric(photo, 'responsivity'), .419408, 1e-5)
  close(metric(run('photodiode', { power: 20 }), 'photocurrent'), 2 * metric(photo, 'photocurrent'))
  const solar = run('solar'); assert.ok(metric(solar, 'vmpp') < metric(solar, 'voc')); assert.ok(metric(solar, 'ff') > 0 && metric(solar, 'ff') < 1)
  assert.ok(run('solar', { optical_input: .01 }).checks.some(c => c.id === 'energy' && !c.passed))
  const vm = metric(solar, 'vmpp'), vo = metric(solar, 'voc'), is = solar.config.parameters.isat, iph = .03, nvt = 1.2 * thermalVoltage(300)
  close(iph + is - is * Math.exp(vm / nvt) * (1 + vm / nvt), 0, 1e-7)
})

test('BJT polarities mirror each other and current conservation holds in saturation and active regions', () => {
  const npn = run('npn'), pnp = run('pnp')
  for (const id of ['collector', 'base', 'emitter']) curve(npn, id).y.forEach((v, i) => close(v, -curve(pnp, id).y[i]))
  const ic = curve(npn, 'collector'), ib = curve(npn, 'base'), ie = curve(npn, 'emitter')
  ic.y.forEach((value, i) => close(value + ib.y[i] + ie.y[i], 0))
  assert.ok(Math.abs(ic.y[0] / ib.y[0]) < 2)
  assert.ok(ic.y.at(-1) / ib.y.at(-1) > 90)
})

test('MOS channel geometry, sign conventions and MOS-capacitor root balance remain consistent', () => {
  const base = run('nmos'), twice = run('nmos', { width: 20 })
  close(metric(twice, 'current'), 2 * metric(base, 'current'))
  const pmos = run('pmos', { mobility: 450 }); close(metric(pmos, 'current'), -metric(base, 'current'))
  const mos = run('moscap'); assert.ok(mos.checks.every(c => c.passed))
  const lf = curve(mos, 'capacitance_lf'), hf = curve(mos, 'capacitance_hf')
  assert.ok(lf.y.at(-1) > hf.y.at(-1)); assert.ok(Math.max(...lf.y) <= metric(mos, 'cox') * 1.001)
  assert.ok(run('moscap', { na: 1e13, temperature: 450 }).warnings.length)
  const cmos = run('cmos'); close(metric(cmos, 'switching'), 1.65, 1e-7); assert.ok(curve(cmos, 'transfer').y[0] > 3.29)
})

test('SCR requires a trigger and enough holding current, including after a failed trigger', () => {
  const failed = run('scr', { holding: 100, trigger: 2, supply: 20, load: 100 })
  assert.ok(curve(failed, 'up').y.every(v => v === 0)); assert.ok(curve(failed, 'down').y.every(v => v === 0))
  const normal = run('scr'); assert.ok(curve(normal, 'up').y.some(v => v > 0)); assert.ok(curve(normal, 'down').y.some((v, i) => v > curve(normal, 'up').y[i]))
})

test('RC and RLC reference values match their dimensional limits and rectifier refinement stabilizes ripple', () => {
  const rc = run('rc'); close(metric(rc, 'tau'), 1e-4); close(metric(rc, 'cutoff'), 1591.5494309189535)
  const charging = curve(rc, 'charging'); close(science.interpolate(charging, 1e-4), 5 * (1 - Math.exp(-1)), 2e-4)
  const rlc = run('rlc'); close(metric(rlc, 'frequency'), 15915.494309189534); close(metric(rlc, 'quality'), 100)
  const coarse = metric(run('rectifier', {}, 501), 'ripple'), fine = metric(run('rectifier', {}, 1001), 'ripple')
  assert.ok(Math.abs(coarse - fine) < .1)
})

test('SRH low-injection decay matches the exponential limit and high-injection lifetime tends to 2τ', () => {
  const low = run('recombination', { excess: 1e10 }), ref = curve(low, 'decay'), srh = curve(low, 'srh_decay')
  close(srh.y.at(-1), ref.y.at(-1), 1e-4)
  const high = run('recombination', { nd: 1e13, excess: 1e18 }); assert.ok(curve(high, 'lifetime').y.at(-1) > 199)
  assert.ok(curve(high, 'srh_decay').y.at(-1) > curve(high, 'decay').y.at(-1))
})

test('fabrication models conserve visible dose, obey Deal–Grove and expose mask exhaustion', () => {
  const diffusion = run('diffusion'); close(metric(diffusion, 'visible_dose'), 1e14, 1e-5)
  close(metric(run('diffusion', { time: 2400 }), 'length'), 2 * metric(diffusion, 'length'))
  const implant = run('implantation'); close(metric(implant, 'sigma') ** 2, .08 ** 2 + 2 * 1e-4 * 600)
  assert.ok(metric(implant, 'substrate') < 100); assert.ok(implant.checks.every(c => c.passed))
  assert.ok(run('oxidation').checks.every(c => c.passed))
  assert.ok(run('etching', { time: 30 }).checks.some(c => c.id === 'mask_valid' && !c.passed))
  const litho = run('lithography'); close(metric(litho, 'resolution'), .5 * 193 / .85)
  close(metric(run('deposition'), 'sheet'), .135)
  close(metric(run('yield'), 'poisson'), Math.exp(-.5) * 100)
})

test('studies are seeded, preserve exact inputs and reject clipped or invalid distributions', () => {
  const config = defaultConfig('pn'), original = JSON.stringify(config), request = { type: 'montecarlo', parameter: 'na', variation: 8, samples: 20, seed: 2026 }
  const a = runStudy(config, request), b = runStudy(config, request)
  assert.deepEqual(a, b); assert.equal(JSON.stringify(config), original); assert.equal(a.runs.length, 20)
  assert.ok(new Set(a.runs.map(r => r.result.config.parameters.na)).size > 10)
  assert.throws(() => runStudy(config, { ...request, parameter: 'ideality' }), /rango|range/)
  assert.throws(() => run('pn', { start: 1, stop: 0 }), /barrido|Sweep/)
  assert.throws(() => run('pn', { temperature: NaN }))
  assert.throws(() => run('transport', { gradient: -1e22 }), /negativ/)
})

test('measurement CSV, weighted regression, diode extraction and residuals use numeric data without extrapolation', () => {
  const parsed = science.parseMeasurement('V;I;sigma\n0;1;.1\n1;3;.1\n2;5;.1\n3;7;.1')
  const fit = science.linearFit(parsed.x, parsed.y, parsed.sigma); close(fit.slope, 2); close(fit.intercept, 1); close(fit.slopeStdError, .1 / Math.sqrt(5))
  assert.throws(() => science.parseMeasurement('x,y\n1,2\n2,\n3,4'))
  assert.throws(() => science.parseMeasurement('x,y\n1,2\n2,""\n3,4'))
  assert.throws(() => science.linearFit([0, 1, 2], [1, 2, 3], [1e-300, 1e-300, 1e-300]), /rango numérico/)
  assert.throws(() => science.linearFit([1, 1, 1], [1, 2, 3]))
  const x = physics.linspace(.2, .5, 101), n = 1.3, is = 2e-12, measurement = { x, y: x.map(x => is * (Math.exp(x / (n * thermalVoltage(300))) - 1)) }
  const extracted = science.diodeFit(measurement, 300, .3, .5); close(extracted.ideality, n, 1e-4); close(extracted.isat, is, 1e-3)
  const model = { x: [0, 1, 2], y: [1, 3, 5] }, comparison = science.compareMeasurement({ x: [-1, 0, .5, 1, 2, 3], y: [100, 1, 2, 3, 5, 200] }, model)
  assert.equal(comparison.n, 4); assert.equal(comparison.rmse, 0)
  const stats = science.statistics([1, 2, 3]); close(stats.mean, 2); close(stats.standardDeviation, 1)
})
