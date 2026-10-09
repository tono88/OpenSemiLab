import { useEffect, useRef, useState } from 'react'
import { Plot, type PlotOverlay } from '../Plot'
import { downloadFile } from './scientific'
import type { LabSeries, Locale, Result } from './types'
import type { Series } from '../types'

export function number(value: number) {
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  return magnitude >= 1e4 || magnitude < .001 ? value.toExponential(3) : Number(value.toPrecision(5)).toString()
}
export default function LabPlot({ series, overlays = [], locale, result, provenance = {} }: { series?: LabSeries; overlays?: PlotOverlay[]; locale: Locale; result?: Result | null; provenance?: Record<string, unknown> }) {
  const es = locale === 'es', host = useRef<HTMLDivElement>(null), [logX, setLogX] = useState(false), [logY, setLogY] = useState(false)
  useEffect(() => { setLogX(series?.x_label === 'Frequency'); setLogY(false) }, [series?.name])
  const prepare = (s: Series) => {
    const indices = s.x.flatMap((x, i) => Number.isFinite(x) && Number.isFinite(s.y[i]) && (!logX || x > 0) && (!logY || s.y[i] > 0) ? [i] : [])
    return { ...s, x: indices.map(i => logX ? Math.log10(s.x[i]) : s.x[i]), y: indices.map(i => logY ? Math.log10(s.y[i]) : s.y[i]) }
  }
  const prepared = series ? prepare({ ...series, name: series.label[locale] }) : undefined, compared = overlays.map(overlay => ({ ...overlay, series: prepare(overlay.series) })), omitted = series ? series.x.length - (prepared?.x.length ?? 0) : 0
  function exportSvg() {
    const original = host.current?.querySelector('svg')
    if (!original) return
    const clone = original.cloneNode(true) as SVGSVGElement, live = original.querySelectorAll('*'), copied = clone.querySelectorAll('*')
    // Resolve CSS into SVG presentation styles for an editable standalone figure.
    live.forEach((element, index) => { const style = getComputedStyle(element), target = copied[index]; target.setAttribute('style', ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'opacity', 'text-anchor'].map(property => `${property}:${style.getPropertyValue(property)}`).join(';')) })
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', '1240'); clone.setAttribute('height', '476')
    const metadata = document.createElementNS('http://www.w3.org/2000/svg', 'metadata')
    metadata.textContent = JSON.stringify({ ...provenance, model: result?.model ?? provenance.model, revision: result?.revision ?? provenance.revision, input: result?.config ?? provenance.input, series: series?.name, x_scale: logX ? 'log10 positive' : 'linear', y_scale: logY ? 'log10 positive' : 'linear', omitted_nonpositive: omitted, view: 'current zoom/pan', overlays: overlays.map(o => ({ label: o.label, data_class: o.pointsOnly ? 'user-supplied measurement' : 'calculated reference' })), primary_data_class: 'calculated reference' })
    clone.prepend(metadata); downloadFile(`${result?.config.device ?? 'experiment'}-${series?.name ?? 'curve'}.svg`, new XMLSerializer().serializeToString(clone), 'image/svg+xml')
  }
  return <div className="dl-plot" ref={host}>
    <div className="dl-plot-toolbar"><label><input type="checkbox" checked={logX} onChange={event => setLogX(event.target.checked)}/> {es ? 'Log eje X' : 'Log X axis'}</label><label><input type="checkbox" checked={logY} onChange={event => setLogY(event.target.checked)}/> {es ? 'Log eje Y' : 'Log Y axis'}</label><button disabled={!prepared?.x.length} onClick={exportSvg}>{es ? 'Exportar SVG' : 'Export SVG'}</button></div>
    <Plot series={prepared} overlays={compared} locale={locale} formatX={value => number(logX ? 10 ** value : value)} formatY={value => number(logY ? 10 ** value : value)}/>
    {omitted > 0 && <p className="dl-caption">{es ? `Escala logarítmica: se omiten ${omitted} puntos con x o y ≤ 0. El CSV/JSON conserva todos los valores y sus signos.` : `Log scale: ${omitted} points with x or y ≤ 0 are omitted. CSV/JSON keeps all values and signs.`}</p>}
    {series && <p className="dl-curve-explanation">{series.explanation[locale]}</p>}
  </div>
}

export function Histogram({ values, unit, locale }: { values: number[]; unit: string; locale: Locale }) {
  if (!values.length) return null
  const min = Math.min(...values), max = Math.max(...values), span = max - min || Math.abs(min) * .1 || 1, start = max === min ? min - span / 2 : min, bins = Math.min(10, Math.max(4, Math.round(Math.sqrt(values.length))))
  const counts = Array.from({ length: bins }, () => 0)
  values.forEach(value => counts[Math.min(bins - 1, Math.max(0, Math.floor((value - start) / span * bins)))]++)
  const peak = Math.max(...counts), width = 450 / bins
  return <svg className="dl-histogram" viewBox="0 0 530 175" role="img" aria-label={locale === 'es' ? 'Histograma de muestras de Monte Carlo' : 'Monte Carlo sample histogram'}>
    {counts.map((count, i) => <g key={i}><rect x={55 + i * width} y={130 - count / peak * 95} width={width - 4} height={count / peak * 95} fill="#45e6a6" opacity=".7"/><text x={55 + (i + .5) * width} y={123 - count / peak * 95}>{count}</text></g>)}
    <line x1="55" y1="130" x2="505" y2="130" stroke="#526e65"/><text x="55" y="150" textAnchor="start">{number(start)}</text><text x="505" y="150" textAnchor="end">{number(start + span)}</text><text x="280" y="172">{locale === 'es' ? 'Valor muestreado' : 'Sampled value'} ({unit})</text>
  </svg>
}
