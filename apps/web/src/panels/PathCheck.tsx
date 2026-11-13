import { useEffect, useState } from 'preact/hooks'
import type { PathCheckResponse, PathOutcome, ScenarioDetail } from '@tradecourt/core'
import { api } from '../api'
import { getError, signed, timestamp } from '../format'
import { PriceChart } from '../components/PriceChart'
import { t } from '../i18n'

export const pathOutcomeLabel = (o: PathOutcome) => t(`path.${o}`)

type Props = {
  detail: ScenarioDetail
  onError: (message: string) => void
  /** Reports the evaluated path outcome so grading can suggest verdicts from price action. */
  onResult?: (outcome: PathOutcome | null) => void
}

export function PathCheck({ detail, onError, onResult }: Props) {
  const { scenario, outcome } = detail
  const [datasetId, setDatasetId] = useState<string | undefined>(undefined)
  const [data, setData] = useState<PathCheckResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!scenario.marketRef) return
    let current = true
    setLoading(true)
    api.pathCheck(scenario.id, datasetId)
      .then((res) => { if (current) { setData(res); onResult?.(res.evaluation.outcome) } })
      .catch((e: unknown) => current && onError(getError(e)))
      .finally(() => current && setLoading(false))
    return () => { current = false }
  }, [scenario.id, scenario.marketRef, datasetId, onError, onResult])

  if (!scenario.marketRef) {
    return (
      <section className="path-check" data-testid="path-check">
        <h3>{t('path.title')} <span className="muted">{t('path.reference')}</span></h3>
        <p className="muted small" data-testid="path-check-unlinked">{t('path.unlinked')}</p>
      </section>
    )
  }

  const ev = data?.evaluation
  const options = data ? [data.dataset, ...data.candidates.filter((d) => d.id !== data.dataset.id)] : []
  const diff = ev && outcome && ev.referenceR !== null && ev.outcome !== 'OPEN' ? outcome.rMultiple - ev.referenceR : null
  const reasonMismatch = ev && outcome && (
    (ev.outcome === 'TARGET_FIRST' && outcome.exitReason === 'STOP') ||
    (ev.outcome === 'STOP_FIRST' && outcome.exitReason === 'TARGET')
  )

  return (
    <section className="path-check" aria-labelledby="path-check-title" data-testid="path-check">
      <div className="grading-head">
        <h3 id="path-check-title">{t('path.title')} <span className="muted">{t('path.referenceFull')}</span></h3>
        <span className="muted small">{t('path.asOf', { date: scenario.marketRef.asOfDate, local: timestamp(scenario.marketRef.asOfAt) })}</span>
      </div>
      {options.length > 0 && (
        <label className="path-dataset">{t('path.datasetLabel')}
          <select data-testid="path-dataset" value={data?.dataset.id ?? ''} onChange={(e) => setDatasetId(e.currentTarget.value)}>
            {options.map((d) => <option key={d.id} value={d.id}>{d.sourceName} · {d.timeframe} · {d.firstDate}→{d.lastDate}{d.tzOffset ? ` · UTC${d.tzOffset}` : t('path.tzUnset')}</option>)}
          </select>
        </label>
      )}
      {loading && !data ? <p className="muted small" aria-busy="true">{t('path.checking')}</p> : ev && data && (
        <>
          <div className={'path-result ' + ev.outcome.toLowerCase()} data-testid="path-result">
            <strong data-testid="path-outcome">{pathOutcomeLabel(ev.outcome)}</strong>
            {ev.referenceR !== null && <span data-testid="path-r" className={ev.referenceR >= 0 ? 'positive' : 'negative'}>{signed(ev.referenceR)}R{ev.outcome === 'OPEN' ? t('path.openNote') : ''}</span>}
            {ev.decidedDate && ev.outcome !== 'OPEN' && <span>{t('path.decided', { date: ev.decidedDate, n: ev.barsChecked })}</span>}
            {ev.outcome === 'OPEN' && <span>{t('path.openChecked', { n: ev.barsChecked, date: ev.decidedDate ?? '' })}</span>}
          </div>
          {ev.gap && <p className="warn small" data-testid="path-gap">{t('path.gap', { r: signed(ev.gapOpenR ?? 0) })}</p>}
          {(ev.mfeR !== null || ev.maeR !== null) && (
            <p className="small muted">{t('path.mfeMae', { mfe: ev.mfeR === null ? '—' : signed(ev.mfeR) + 'R', mae: ev.maeR === null ? '—' : signed(ev.maeR) + 'R' })}</p>
          )}
          {ev.outcome === 'NO_DATA' && <p className="muted small">{t('path.noData')}</p>}
          {data.chart.candles.length > 0 && (
            <PriceChart
              candles={data.chart.candles}
              label={t('path.chartLabel', { name: data.dataset.sourceName })}
              levels={{ entry: scenario.entry, stop: scenario.stop, target: scenario.target }}
              asOfIndex={data.chart.firstAfterIndex ?? data.chart.candles.length}
              decidedIndex={ev.outcome === 'OPEN' ? null : data.chart.decidedIndex}
              testId="path-chart"
              ranges
            />
          )}
          {outcome && ev.outcome !== 'NO_DATA' && (
            <div className="path-compare" data-testid="path-compare">
              <span>{t('path.yourResult')} <strong className={outcome.rMultiple >= 0 ? 'positive' : 'negative'}>{signed(outcome.rMultiple)}R</strong></span>
              <span>{t('path.csvReference')} <strong>{ev.referenceR === null ? '—' : signed(ev.referenceR) + 'R'}</strong></span>
              {diff !== null && <span>{t('path.difference')} <strong className={diff >= 0 ? 'positive' : 'negative'}>{signed(diff)}R</strong></span>}
              {reasonMismatch && <span className="warn" data-testid="path-mismatch">{t('path.mismatch')}</span>}
            </div>
          )}
          <p className="muted small">{t('path.assumptions')}</p>
        </>
      )}
    </section>
  )
}
