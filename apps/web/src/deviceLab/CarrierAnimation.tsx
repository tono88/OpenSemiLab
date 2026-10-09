import { useEffect, useRef, useState } from 'react'
import { getDevice } from './catalogue'
import type { Config, Locale } from './types'

type Particle = { x: number; y: number; electron: boolean; phase: number }
export default function CarrierAnimation({ config, locale }: { config: Config; locale: Locale }) {
  const es = locale === 'es', canvas = useRef<HTMLCanvasElement>(null)
  const [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [quality, setQuality] = useState(40)
  const [mechanism, setMechanism] = useState<'net' | 'drift' | 'diffusion'>('net')
  const device = getDevice(config.device), isMos = ['nmos', 'pmos', 'moscap', 'igbt'].includes(config.device), isBjt = ['npn', 'pnp'].includes(config.device)
  const uniform = ['material', 'transport', 'resistor', 'hall', 'recombination'].includes(config.device), metal = config.device === 'schottky', capacitor = config.device === 'moscap', led = config.device === 'led'
  const nOnly = metal || ['transport', 'resistor', 'hall'].includes(config.device)
  const fieldSign = uniform ? Math.sign(config.parameters.field ?? 1) : -1
  const electronDiffusionSign = config.device === 'transport' ? -Math.sign(config.parameters.gradient) : -1
  const illuminated = config.device === 'solar' ? config.parameters.photo_current > 0 : config.device === 'photodiode' && config.parameters.power > 0
  const polarity = config.device === 'pmos' || config.device === 'pnp' ? -1 : 1
  const [visualBias, setVisualBias] = useState(0)
  useEffect(() => { setPlaying(false); setMechanism('net'); setVisualBias(config.parameters.bias ?? (led ? Math.min(3, config.parameters.stop) : isBjt ? config.parameters.vbe : isMos ? config.parameters.gate ?? 1.8 : 0)) }, [config.device])

  useEffect(() => {
    const element = canvas.current, context = element?.getContext('2d')
    if (!element || !context) return
    let frame = 0, last = 0, elapsed = 0, visible = true, width = 800
    const height = 255, emitting = led && visualBias > (config.parameters.bandgap ?? 1.9)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const particles: Particle[] = Array.from({ length: quality }, (_, i) => ({ electron: nOnly || i % 2 === 0, x: uniform ? .04 + .92 * ((i * .618) % 1) : metal ? .56 + .4 * ((i * .618) % 1) : i % 2 === 0 ? .52 + .44 * ((i * .618) % 1) : .04 + .42 * ((i * .618) % 1), y: .28 + .5 * ((i * .437) % 1), phase: i * 1.94 }))
    const text = (content: string, x: number, y: number, color = '#b7ccc7', size = 12) => { context.fillStyle = color; context.font = `${size}px monospace`; context.textAlign = 'center'; context.fillText(content, x, y) }
    const arrow = (x1: number, x2: number, y: number, color: string) => {
      const sign = Math.sign(x2 - x1); context.strokeStyle = color; context.lineWidth = 2; context.beginPath(); context.moveTo(x1, y); context.lineTo(x2, y); context.lineTo(x2 - sign * 7, y - 5); context.moveTo(x2, y); context.lineTo(x2 - sign * 7, y + 5); context.stroke()
    }
    const draw = () => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height); context.fillStyle = '#04100f'; context.fillRect(0, 0, width, height)
      const left = 28, right = width - 28, span = right - left, top = 38, bottom = 207
      if (isMos) {
        context.fillStyle = polarity > 0 ? '#36243b' : '#163d4c'; context.fillRect(left, 115, span, 90)
        if (!capacitor) { context.fillStyle = polarity > 0 ? '#163d4c' : '#452640'; context.fillRect(left, 101, span * .22, 40); context.fillRect(right - span * .22, 101, span * .22, 40) }
        context.fillStyle = '#b5af77'; context.fillRect(left + span * .27, 76, span * .46, 14); context.fillStyle = '#476b6c'; context.fillRect(left + span * .27, 46, span * .46, 29)
        if (visualBias > (config.parameters.threshold ?? .7)) { context.fillStyle = polarity > 0 ? '#56c5f590' : '#f3a5d490'; context.fillRect(left + span * .22, 108, span * .56, 5) }
        if (!capacitor) { text(es ? 'FUENTE' : 'SOURCE', left + span * .11, 93); text(es ? 'DRENADOR' : 'DRAIN', right - span * .11, 93) }
        text(es ? 'PUERTA' : 'GATE', width / 2, 35); text('SiO₂', width / 2, 87, '#fff5ba', 10); text(es ? 'SUSTRATO' : 'SUBSTRATE', width / 2, 193, '#dfb3d8', 10)
      } else if (isBjt) {
        context.fillStyle = polarity > 0 ? '#153c4c' : '#452640'; context.fillRect(left, top, span * .4, bottom - top); context.fillRect(left + span * .6, top, span * .4, bottom - top); context.fillStyle = polarity > 0 ? '#452640' : '#153c4c'; context.fillRect(left + span * .4, top, span * .2, bottom - top)
        text(polarity > 0 ? 'N · E' : 'P · E', left + span * .2, 63); text(polarity > 0 ? 'P · B' : 'N · B', width / 2, 63); text(polarity > 0 ? 'N · C' : 'P · C', left + span * .8, 63)
      } else {
        context.fillStyle = metal ? '#4a5259' : uniform ? '#153b49' : '#43243e'; context.fillRect(left, top, span / 2, bottom - top); context.fillStyle = '#153b49'; context.fillRect(left + span / 2, top, span / 2, bottom - top)
        const depletion = uniform ? .03 : Math.min(.34, .10 * Math.sqrt(Math.max(.1, 1 - visualBias / .7)))
        if (!uniform) { context.fillStyle = '#122d26'; context.fillRect(width / 2 - span * depletion / 2, top, span * depletion, bottom - top) }
        if (config.device === 'pin') { context.fillStyle = '#235043'; context.fillRect(width / 2 - span * .14, top, span * .28, bottom - top); text('I', width / 2, 64) }
        text(metal ? (es ? 'METAL' : 'METAL') : uniform ? (es ? 'PORTADORES' : 'CARRIERS') : 'P', left + span * .2, 64, '#f4b5de'); text(uniform ? 'Si' : 'N', left + span * .8, 64, '#83d5f2')
        if (!uniform && !metal) { for (let i = 0; i < 4; i++) { text('−', width / 2 - 14, 93 + 25 * i, '#f4b5de'); text('+', width / 2 + 14, 93 + 25 * i, '#83d5f2') } }
      }
      for (const particle of particles) {
        const x = left + particle.x * span, y = isMos && particle.electron === (polarity > 0) ? 113 + Math.sin(particle.phase + elapsed) * 4 : top + particle.y * (bottom - top)
        context.beginPath(); context.arc(x, y, particle.electron ? 4 : 5, 0, Math.PI * 2)
        if (particle.electron) { context.fillStyle = '#71d5ff'; context.fill() } else { context.strokeStyle = '#f3a8d8'; context.lineWidth = 2; context.stroke() }
      }
      if (emitting || illuminated) {
        context.strokeStyle = '#f5d178'; context.lineWidth = 2
        for (let i = 0; i < 4; i++) { const x = width / 2 + 26 * Math.sin(elapsed * 2 + i), direction = config.device === 'led' ? -1 : 1; const offset = ((elapsed * 38 + i * 19) % 50); context.beginPath(); for (let k = 0; k < 28; k++) { const xx = x + Math.sin(k * .65) * 4, yy = 100 + direction * (offset + k); if (k === 0) context.moveTo(xx, yy); else context.lineTo(xx, yy) } context.stroke() }
        text('hν', width / 2 + 45, 30, '#f5d178')
      }
      if (mechanism === 'drift') { if (fieldSign) { arrow(width * .25, width * (.25 - fieldSign * .17), 229, '#71d5ff'); if (!nOnly) arrow(width * .75, width * (.75 + fieldSign * .17), 229, '#f3a8d8') } text(es ? 'Deriva: e⁻ contra E; h⁺ a favor de E' : 'Drift: e⁻ against E; h⁺ along E', width / 2, 250, '#87aca2', 10) }
      else if (mechanism === 'diffusion') { if (electronDiffusionSign) { arrow(width * .72, width * (.72 + electronDiffusionSign * .18), 229, '#71d5ff'); if (!nOnly) arrow(width * .28, width * (.28 - electronDiffusionSign * .18), 229, '#f3a8d8') } text(es ? 'Difusión: desde mayor hacia menor concentración' : 'Diffusion: from higher to lower concentration', width / 2, 250, '#87aca2', 10) }
      else text(capacitor ? (es ? 'Carga superficial controlada por la puerta' : 'Gate-controlled surface charge') : isMos ? (es ? 'Canal controlado por la puerta' : 'Gate-controlled channel') : isBjt ? (es ? 'Inyección del emisor; transporte por la base' : 'Emitter injection; transport across the base') : illuminated ? (es ? 'La luz genera pares; el campo los separa' : 'Light generates pairs; the field separates them') : uniform ? (es ? 'Movimiento térmico de portadores en el material' : 'Thermal carrier motion in the material') : Math.abs(visualBias) < .015 ? (es ? 'Equilibrio: deriva y difusión se compensan' : 'Equilibrium: drift and diffusion balance') : visualBias > 0 ? (es ? 'Directa: se facilita la inyección' : 'Forward: injection is easier') : (es ? 'Inversa: aumenta el agotamiento' : 'Reverse: depletion increases'), width / 2, 237, '#9ebdb0', 11)
    }
    const resize = new ResizeObserver(entries => { width = Math.max(280, entries[0].contentRect.width); element.width = width * dpr; element.height = height * dpr; draw() })
    resize.observe(element)
    const updateScheduling = () => { cancelAnimationFrame(frame); frame = 0; last = 0; if (playing && visible && !document.hidden) frame = requestAnimationFrame(tick) }
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; updateScheduling() }); observer.observe(element)
    const tick = (now: number) => {
      if (playing && visible && !document.hidden && now - last >= 1000 / 30) {
        const dt = Math.min(.07, last ? (now - last) / 1000 : .033) * speed; elapsed += dt; last = now
        for (const particle of particles) {
          const direction = particle.electron ? -1 : 1
          let drift = mechanism === 'drift' ? direction * fieldSign * .09 : mechanism === 'diffusion' ? -direction * electronDiffusionSign * .09 : Math.sign(visualBias) * direction * Math.min(.18, Math.abs(visualBias) * .17)
          if (illuminated && mechanism === 'net') drift = -direction * .09
          if (isMos) drift = !capacitor && particle.electron === (polarity > 0) && visualBias > (config.parameters.threshold ?? .7) ? .12 : 0
          if (isBjt) drift = visualBias > .5 && particle.electron === (polarity > 0) ? .09 : 0
          particle.x += drift * dt + Math.sin(elapsed * 6 + particle.phase) * .006 * dt
          const edge = metal ? .54 : .03
          if (particle.x > .97) particle.x = edge; if (particle.x < edge) particle.x = .97
          particle.y = Math.max(.2, Math.min(.83, particle.y + Math.sin(elapsed * 3 + particle.phase) * .018 * dt))
        }
        draw()
      }
      frame = playing && visible && !document.hidden ? requestAnimationFrame(tick) : 0
    }
    document.addEventListener('visibilitychange', updateScheduling)
    draw(); updateScheduling()
    return () => { cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); document.removeEventListener('visibilitychange', updateScheduling) }
  }, [config.device, config.parameters.threshold, config.parameters.bandgap, isMos, isBjt, uniform, metal, nOnly, fieldSign, electronDiffusionSign, capacitor, illuminated, led, polarity, playing, speed, quality, mechanism, visualBias, locale])

  return <section className="carrier-view" aria-label={es ? 'Animación de electrones y huecos' : 'Electron and hole animation'}>
    <div className="dl-section-title"><div><span>{es ? 'MICROSCOPIO CONCEPTUAL' : 'CONCEPTUAL MICROSCOPE'}</span><h3>{device.name[locale]}</h3></div><small>{es ? 'EN ESTE NAVEGADOR' : 'IN THIS BROWSER'}</small></div>
    <canvas ref={canvas} role="img" aria-label={es ? 'Electrones azules, huecos rosados y regiones del dispositivo' : 'Blue electrons, pink holes and device regions'} />
    <div className="dl-animation-controls"><button type="button" aria-pressed={playing} onClick={() => setPlaying(value => !value)}>{playing ? (es ? 'Pausar portadores' : 'Pause carriers') : (es ? 'Animar portadores' : 'Animate carriers')}</button><label>{es ? 'Mecanismo' : 'Mechanism'}<select disabled={isMos || isBjt} value={mechanism} onChange={event => setMechanism(event.target.value as typeof mechanism)}><option value="net">{es ? 'Movimiento neto' : 'Net motion'}</option><option value="drift">{es ? 'Sólo deriva' : 'Drift only'}</option><option value="diffusion">{es ? 'Sólo difusión' : 'Diffusion only'}</option></select></label><label>{es ? 'Velocidad visual' : 'Visual speed'}<select value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[.5, 1, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label><label>{es ? 'Partículas' : 'Particles'}<select value={quality} onChange={event => setQuality(Number(event.target.value))}>{[20, 40, 80].map(value => <option key={value}>{value}</option>)}</select></label></div>
    {!uniform && <label className="dl-visual-bias">{isMos ? (es ? 'Puerta visual |V|' : 'Visual gate |V|') : (es ? 'Polarización visual' : 'Visual bias')} <input type="range" min={isMos || isBjt || led ? 0 : -2} max={isMos ? 5 : led ? 4 : isBjt ? .85 : .65} step=".05" value={visualBias} onChange={event => setVisualBias(Number(event.target.value))}/><b>{visualBias.toFixed(2)} V</b></label>}
    <div className="carrier-legend"><span><i className="electron"/> e⁻ · {es ? 'electrón' : 'electron'}</span><span><i className="hole"/> h⁺ · {es ? 'hueco' : 'hole'}</span><span><i className="photon"/> hν · {es ? 'fotón' : 'photon'}</span></div>
    <p className="dl-caption">{es ? 'Representación conceptual: posiciones, cantidades y velocidades visuales no son datos de TCAD. La polarización visual no modifica las curvas calculadas. La animación se pausa fuera de pantalla y con la pestaña oculta; usa como máximo 80 partículas a 30 fps.' : 'Conceptual representation: visual positions, counts and speeds are not TCAD data. Visual bias does not modify calculated curves. Animation pauses offscreen and in hidden tabs; at most 80 particles at 30 fps.'}</p>
  </section>
}
