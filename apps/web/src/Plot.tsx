import type { Series } from './types'

function scale(values: number[], minOut: number, maxOut: number) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1
  return values.map(value => minOut + ((value - min) / span) * (maxOut - minOut))
}

export function Plot({ series, color = '#45e6a6' }: { series?: Series; color?: string }) {
  if (!series) return <div className="plot empty">Run the experiment to see this result.</div>
  const xs = scale(series.x, 36, 584), ys = scale(series.y, 196, 18)
  const points = xs.map((x, index) => `${x},${ys[index]}`).join(' ')
  return <div className="plot">
    <svg viewBox="0 0 620 230" role="img" aria-label={`${series.y_label} by ${series.x_label}`}>
      <line x1="36" y1="8" x2="36" y2="198" className="axis"/><line x1="36" y1="198" x2="600" y2="198" className="axis"/>
      {[54, 102, 150].map(y => <line key={y} x1="36" y1={y} x2="600" y2={y} className="grid"/>)}
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round"/>
      <text x="318" y="224" textAnchor="middle">{series.x_label} ({series.x_unit})</text>
      <text x="10" y="105" textAnchor="middle" transform="rotate(-90 10 105)">{series.y_label} ({series.y_unit})</text>
    </svg>
  </div>
}
