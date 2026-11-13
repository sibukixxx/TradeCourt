import { useEffect, useState } from 'preact/hooks'
import type { Bucket, DecisionAnalysis } from '@tradecourt/core'
import { api, exportUrl } from '../api'
import { getError, signed, timestamp } from '../format'
import { SeriesChart } from '../components/SeriesChart'
import { t } from '../i18n'

const windows: (number | null)[] = [null, 50, 20, 10]
const windowLabel = (w: number | null) => (w === null ? t('insights.windowAll') : t('insights.windowLast', { n: w }))
const exitKeys = ['TARGET', 'STOP', 'INVALIDATED', 'MANUAL'] as const

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const avg = (v: number | null) => (v === null ? '—' : `${signed(v)}R`)
const tone = (v: number | null) => (v === null ? '' : v >= 0 ? 'positive' : 'negative')

function BucketRow({ label, b, testId }: { label: string; b: Bucket; testId?: string }) {
  return (
    <tr className="static" data-testid={testId}>
      <th>{label}</th><td>{b.count}</td>
      <td className={tone(b.averageR)}>{avg(b.averageR)}</td>
      <td className={b.count ? tone(b.totalR) : ''}>{b.count ? `${signed(b.totalR)}R` : '—'}</td>
      <td>{pct(b.winRate)}</td>
    </tr>
  )
}

type Props = { onError: (message: string) => void }

export function InsightsPanel({ onError }: Props) {
  const [limit, setLimit] = useState<number | null>(null)
  const [analysis, setAnalysis] = useState<DecisionAnalysis | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let current = true
    setLoading(true)
    api.analysis(limit)
      .then((res) => current && setAnalysis(res.analysis))
      .catch((e: unknown) => current && onError(getError(e)))
      .finally(() => current && setLoading(false))
    return () => { current = false }
  }, [limit, onError])

  const a = analysis
  const pc = a?.pathComparison
  const planInsight = a && a.byPlan.followed.averageR !== null && a.byPlan.deviated.averageR !== null
    ? a.byPlan.deviated.averageR < a.byPlan.followed.averageR
      ? t('insights.planWorse', { d: signed(a.byPlan.deviated.averageR - a.byPlan.followed.averageR) })
      : t('insights.planBetter', { d: signed(a.byPlan.deviated.averageR - a.byPlan.followed.averageR) })
    : null

  return (
    <section className="panel" aria-labelledby="insights-title">
      <div className="section-head">
        <div><span className="eyebrow">05 / DECISION HABITS</span><h2 id="insights-title">Insights</h2><p>{t('insights.intro')}</p></div>
        <span className="tag">PAPER · REFERENCE</span>
      </div>

      <div className="insights-toolbar">
        <div className="segmented" role="group" aria-label={t('insights.windowAria')}>
          {windows.map((w) => (
            <button key={String(w)} type="button" aria-pressed={limit === w} className={limit === w ? 'selected' : ''} onClick={() => setLimit(w)}>{windowLabel(w)}</button>
          ))}
        </div>
        <div className="export-links">
          <a className="secondary" href={exportUrl('csv')} download data-testid="export-csv">{t('insights.exportCsv')}</a>
          <a className="secondary" href={exportUrl('json')} download data-testid="export-json">{t('insights.exportJson')}</a>
        </div>
      </div>

      {loading && !a ? <div className="empty" aria-busy="true">{t('insights.loading')}</div>
        : !a || a.window.closed === 0 ? (
          <div className="empty" data-testid="insights-empty">{t('insights.empty')}</div>
        ) : (
          <div data-testid="insights">
            <p className="muted small">{t('insights.scope', { closed: a.window.closed, all: a.window.scenarios })}{a.window.from && t('insights.scopeRange', { from: timestamp(a.window.from), to: timestamp(a.window.to ?? a.window.from) })}</p>
            <div className="stat-grid four">
              <div className="mini-stat"><span>{t('insights.average')}</span><strong data-testid="ins-average" className={tone(a.overview.averageR)}>{avg(a.overview.averageR)}</strong><small>{t('insights.totalSub', { r: signed(a.overview.totalR) })}</small></div>
              <div className="mini-stat"><span>{t('insights.winRate')}</span><strong data-testid="ins-winrate">{pct(a.overview.winRate)}</strong><small>{t('insights.ofN', { n: a.overview.count })}</small></div>
              <div className="mini-stat"><span>{t('insights.drawdown')}</span><strong data-testid="ins-drawdown" className={a.overview.maxDrawdownR ? 'negative' : ''}>{a.overview.maxDrawdownR ? `-${a.overview.maxDrawdownR.toFixed(2)}R` : '0R'}</strong><small>{t('insights.drawdownSub')}</small></div>
              <div className="mini-stat"><span>{t('insights.beyondStop')}</span><strong data-testid="ins-beyond-stop" className={a.overview.lossBeyondStop ? 'negative' : ''}>{t('common.times', { n: a.overview.lossBeyondStop })}</strong><small>{t('insights.beyondStopSub')}</small></div>
            </div>
            <SeriesChart values={a.equity.map((p) => p.cumulativeR)} label={t('insights.equity')} testId="equity-chart" />

            <div className="insight-grid">
              <section className="insight-card" data-testid="ins-path">
                <h3>{t('insights.pathTitle')} <span className="muted">{t('insights.pathSubtitle')}</span></h3>
                {!pc || pc.compared === 0 ? (
                  <p className="muted small">{t('insights.pathEmpty')}</p>
                ) : (
                  <>
                    <div className="gap-figure"><span>{t('insights.averageGap')}</span><strong data-testid="ins-gap" className={tone(pc.averageGapR)}>{avg(pc.averageGapR)}</strong><small>{t('insights.comparedN', { n: pc.compared })}</small></div>
                    <ul className="gap-list">
                      <li data-testid="ins-missed"><span>{t('insights.missed')}</span><strong>{t('common.times', { n: pc.missedTarget.count })}</strong><em className={pc.missedTarget.count ? 'negative' : ''}>{pc.missedTarget.count ? t('insights.missedR', { r: pc.missedTarget.totalR.toFixed(2) }) : '—'}</em></li>
                      <li data-testid="ins-saved"><span>{t('insights.saved')}</span><strong>{t('common.times', { n: pc.savedFromStop.count })}</strong><em className={pc.savedFromStop.count ? 'positive' : ''}>{pc.savedFromStop.count ? t('insights.savedR', { r: pc.savedFromStop.totalR.toFixed(2) }) : '—'}</em></li>
                      <li data-testid="ins-worse"><span>{t('insights.worse')}</span><strong>{t('common.times', { n: pc.worseThanStop.count })}</strong><em className={pc.worseThanStop.count ? 'negative' : ''}>{pc.worseThanStop.count ? t('insights.worseR', { r: pc.worseThanStop.totalR.toFixed(2) }) : '—'}</em></li>
                      <li><span>{t('insights.matched')}</span><strong>{t('common.times', { n: pc.matched })}</strong><em /></li>
                    </ul>
                  </>
                )}
                {pc && <p className="muted small">{t('insights.excluded', { u: pc.excluded.unlinked, n: pc.excluded.noData, o: pc.excluded.open, a: pc.excluded.ambiguous })}</p>}
              </section>

              <section className="insight-card" data-testid="ins-plan">
                <h3>{t('insights.planTitle')}</h3>
                <div className="table-wrap"><table className="compare-table">
                  <thead><tr><th></th><th>{t('insights.col.count')}</th><th>{t('insights.col.avgR')}</th><th>{t('insights.col.totalR')}</th><th>{t('insights.col.winRate')}</th></tr></thead>
                  <tbody>
                    <BucketRow label={t('insights.followed')} b={a.byPlan.followed} testId="ins-followed" />
                    <BucketRow label={t('insights.deviated')} b={a.byPlan.deviated} testId="ins-deviated" />
                  </tbody>
                </table></div>
                {planInsight && <p className="small insight-note" data-testid="ins-plan-note">{planInsight}</p>}
              </section>

              <section className="insight-card" data-testid="ins-exit">
                <h3>{t('insights.exitTitle')}</h3>
                <div className="table-wrap"><table className="compare-table">
                  <thead><tr><th></th><th>{t('insights.col.count')}</th><th>{t('insights.col.avgR')}</th><th>{t('insights.col.totalR')}</th><th>{t('insights.col.winRate')}</th></tr></thead>
                  <tbody>
                    {exitKeys.map((k) => <BucketRow key={k} label={t(`exit.${k}`)} b={a.byExitReason[k]} />)}
                    <BucketRow label="LONG" b={a.bySide.LONG} />
                    <BucketRow label="SHORT" b={a.bySide.SHORT} />
                  </tbody>
                </table></div>
              </section>
            </div>
            <p className="muted small">{t('insights.disclaimer')}</p>
          </div>
        )}
    </section>
  )
}
