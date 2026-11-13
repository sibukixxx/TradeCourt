import { CHART_H, CHART_W, linePoints, yScale } from '../market'
import { signed } from '../format'
import { t } from '../i18n'

type Props = { values: number[]; label: string; testId?: string }

/** Line chart of a numeric series with a zero baseline (e.g. cumulative paper R). */
export function SeriesChart({ values, label, testId = 'series-chart' }: Props) {
  if (values.length === 0) return null
  const series = [0, ...values] // start from 0R before the first record
  const min = Math.min(...series)
  const max = Math.max(...series)
  const y = yScale(min, max)
  return (
    <div className="chart-wrap">
      <div className="chart-axis"><span>{signed(max)}R</span><span>{label}</span></div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" role="img" aria-label={label} data-testid={testId}>
        <line vector-effect="non-scaling-stroke" x1="0" x2={CHART_W} y1={y(0)} y2={y(0)} className="level entry" />
        <polyline vector-effect="non-scaling-stroke" points={linePoints(series, min, max)} fill="none" stroke="#6bceb6" stroke-width="2.5" stroke-linejoin="round" />
      </svg>
      <div className="chart-axis"><span>{signed(min)}R</span><span>{t('chart.records', { n: values.length })}</span></div>
    </div>
  )
}
