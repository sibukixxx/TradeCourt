import type { Candle } from '@tradecourt/core'
import { CHART_H, CHART_W, linePoints, xScale, yScale } from '../market'
import { price } from '../format'

export type ChartLevels = { entry: number; stop: number; target: number }

type Props = {
  candles: Candle[]
  label: string
  levels?: ChartLevels
  /** Index of the first candle after the as-of close (a vertical "as-of" divider is drawn before it). */
  asOfIndex?: number | null
  /** Index of the deciding candle (stop/target touched). */
  decidedIndex?: number | null
  /** Draw each candle's high-low range (needed where stop/target touches are judged on highs/lows). */
  ranges?: boolean
  testId?: string
}

// Plots ONLY the user's imported closes. Levels/markers are drawn as overlays; no synthetic data.
export function PriceChart({ candles, label, levels, asOfIndex, decidedIndex, ranges = false, testId = 'close-chart' }: Props) {
  if (candles.length === 0) return null
  const closes = candles.map((c) => c.close)
  const values = [
    ...closes,
    ...(ranges ? candles.flatMap((c) => [c.high, c.low]) : []),
    ...(levels ? [levels.entry, levels.stop, levels.target] : []),
  ]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const y = yScale(min, max)
  const x = xScale(candles.length)
  const divider = asOfIndex === null || asOfIndex === undefined ? null
    : asOfIndex <= 0 ? x(0) : asOfIndex >= candles.length ? x(candles.length - 1) : (x(asOfIndex - 1) + x(asOfIndex)) / 2
  const level = (value: number, cls: string) => (
    <line vector-effect="non-scaling-stroke" x1="0" x2={CHART_W} y1={y(value)} y2={y(value)} className={`level ${cls}`} />
  )
  return (
    <div className="chart-wrap">
      <div className="chart-axis"><span>{price(max)}</span><span>{label}{ranges ? ' ・縦線＝各足の高値〜安値' : ''}</span></div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" role="img" aria-label={label} data-testid={testId}>
        <line vector-effect="non-scaling-stroke" x1="0" y1={CHART_H / 2} x2={CHART_W} y2={CHART_H / 2} className="chart-grid" />
        {levels && level(levels.target, 'target')}
        {levels && level(levels.entry, 'entry')}
        {levels && level(levels.stop, 'stop')}
        {divider !== null && <line vector-effect="non-scaling-stroke" x1={divider} x2={divider} y1="0" y2={CHART_H} className="marker as-of" data-testid="as-of-marker" />}
        {decidedIndex !== null && decidedIndex !== undefined && (
          <line vector-effect="non-scaling-stroke" x1={x(decidedIndex)} x2={x(decidedIndex)} y1="0" y2={CHART_H} className="marker decided" data-testid="decided-marker" />
        )}
        {ranges && candles.map((c, i) => (
          <line key={c.date} vector-effect="non-scaling-stroke" x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} className="range" />
        ))}
        <polyline vector-effect="non-scaling-stroke" points={linePoints(closes, min, max)} fill="none" stroke="#6bceb6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
      <div className="chart-axis"><span>{price(min)}</span><span>{candles[0].date} → {candles[candles.length - 1].date}</span></div>
      {(levels || divider !== null) && (
        <div className="chart-legend">
          {levels && <><span className="lg target">Target {price(levels.target)}</span><span className="lg entry">Entry {price(levels.entry)}</span><span className="lg stop">Stop {price(levels.stop)}</span></>}
          {divider !== null && <span className="lg as-of">│ 仮説時点</span>}
          {decidedIndex !== null && decidedIndex !== undefined && <span className="lg decided">│ 判定足</span>}
        </div>
      )}
    </div>
  )
}
