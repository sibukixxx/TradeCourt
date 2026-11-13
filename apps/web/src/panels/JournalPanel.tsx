import { useState } from 'preact/hooks'
import {
  calculatePaperRMultiple,
  comparePlanToOutcome,
  providerLabels,
  type ExitReason,
  type JournalEntry,
  type JournalSummary,
  type ReviewScorecard,
  type PathOutcome,
  type PlanComparison,
  type ScenarioDetail,
} from '@tradecourt/core'
import { api } from '../api'
import { getError, price, signed, timestamp } from '../format'
import { ReviewGrading, Scorecard, VerdictBadge } from './ReviewGrading'
import { PathCheck } from './PathCheck'
import { t } from '../i18n'

const exitReasons: ExitReason[] = ['TARGET', 'STOP', 'INVALIDATED', 'MANUAL']
const exitLabel = (r: ExitReason) => t(`exit.${r}`)
const zoneLabel = (z: PlanComparison['zone']) => t(`zone.${z}`)

type Props = {
  detail: ScenarioDetail | null
  entries: JournalEntry[]
  summary: JournalSummary | null
  scorecard: ReviewScorecard | null
  loading: boolean
  onSaved: () => Promise<void>
  onOpen: (id: string) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

export function JournalPanel({ detail, entries, summary, scorecard, loading, onSaved, onOpen, onError, onNotice }: Props) {
  const [exitPrice, setExitPrice] = useState('')
  const [exitReason, setExitReason] = useState<ExitReason>('MANUAL')
  const [followedPlan, setFollowedPlan] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [pathOutcome, setPathOutcome] = useState<PathOutcome | null>(null)

  const selected = detail?.scenario
  const exitNum = Number(exitPrice)
  const previewR = selected && exitPrice !== '' && Number.isFinite(exitNum) && exitNum > 0
    ? calculatePaperRMultiple(selected, exitNum) : null
  const outcome = detail?.outcome
  const comparison = selected && outcome ? comparePlanToOutcome(selected, outcome.exitPrice) : null

  // One-tap paper outcome: pick a planned level, then confirm (records are immutable).
  type Quick = { key: 'TARGET' | 'STOP' | 'BREAKEVEN'; label: string; price: number; reason: ExitReason }
  const quickOptions: Quick[] = selected ? [
    { key: 'TARGET', label: t('journal.quickTarget'), price: selected.target, reason: 'TARGET' },
    { key: 'STOP', label: t('journal.quickStop'), price: selected.stop, reason: 'STOP' },
    { key: 'BREAKEVEN', label: t('journal.quickBreakeven'), price: selected.entry, reason: 'MANUAL' },
  ] : []
  const pathKey = pathOutcome === 'TARGET_FIRST' ? 'TARGET' : pathOutcome === 'STOP_FIRST' ? 'STOP' : null
  const [quick, setQuick] = useState<Quick | null>(null)
  const [quickFollowed, setQuickFollowed] = useState(true)
  const [quickNote, setQuickNote] = useState('')

  async function recordQuick() {
    if (!selected || !quick || busy) return
    setBusy(true)
    try {
      await api.paperOutcome(selected.id, { exitPrice: quick.price, exitReason: quick.reason, followedPlan: quickFollowed, note: quickNote })
      setQuick(null); setQuickNote(''); setQuickFollowed(true)
      await onSaved()
      onNotice(t('journal.quickRecorded', { label: quick.label }))
    } catch (e) {
      onError(getError(e))
      await onSaved().catch(() => undefined)
    } finally { setBusy(false) }
  }

  async function saveOutcome(event: Event) {
    event.preventDefault()
    if (!selected || busy) return
    if (!Number.isFinite(exitNum) || exitNum <= 0) { onError(t('journal.positiveExit')); return }
    setBusy(true)
    try {
      await api.paperOutcome(selected.id, { exitPrice: exitNum, exitReason, followedPlan, note })
      setExitPrice(''); setNote(''); setExitReason('MANUAL'); setFollowedPlan(true)
      await onSaved()
      onNotice(t('journal.outcomeSaved'))
    } catch (e) {
      onError(getError(e))
      await onSaved().catch(() => undefined) // e.g. 409: show the already-recorded outcome
    } finally { setBusy(false) }
  }

  return (
    <section className="panel" aria-labelledby="journal-title">
      <div className="section-head">
        <div><span className="eyebrow">04 / LEARN FROM THE RECORD</span><h2 id="journal-title">Journal</h2><p>{t('journal.intro')}</p></div>
        <span className="tag">PAPER ONLY</span>
      </div>

      {loading ? <div className="empty" aria-busy="true">{t('common.loading')}</div> : !selected ? (
        <div className="empty short">{t('journal.noSelection')}</div>
      ) : (
        <div className="journal-layout">
          <div className="case-summary">
            <span className="eyebrow">{t('journal.snapshot')}</span>
            <h3>{selected.symbol} / {selected.side} / {selected.timeframe}</h3>
            <div className="case-prices"><span>ENTRY <strong>{price(selected.entry)}</strong></span><span>STOP <strong>{price(selected.stop)}</strong></span><span>TARGET <strong>{price(selected.target)}</strong></span><span>{t('journal.plannedRr')} <strong>1:{selected.riskReward.toFixed(2)}</strong></span></div>
            <p>{selected.thesis}</p>
            <p className="muted">{t('common.invalidation', { text: selected.invalidation })}</p>
            <small>{t('journal.recordedOn', { date: timestamp(selected.createdAt) })}</small>
            <div className="divider thin" />
            <span className="eyebrow">{t('journal.aiReviews', { n: detail.reviews.length })}</span>
            {detail.reviews.length === 0 ? <p className="muted small">{t('journal.noReviews')}</p> : (
              <ul className="review-mini" data-testid="journal-reviews">
                {detail.reviews.map((r) => (
                  <li key={r.id}><strong>{providerLabels[r.provider]}</strong> <span className={'side ' + (r.role === 'BULL' ? 'long' : 'short-side')}>{r.role}</span> <span className="excerpt">{r.content}</span>{r.grade && <VerdictBadge verdict={r.grade.verdict} />}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="outcome-box">
            {outcome && comparison ? (
              <div data-testid="outcome-result">
                <h3>{t('journal.result')} <span className="tag small-tag">PAPER</span></h3>
                <div className="outcome-value"><span>{t('journal.rPaper')}</span><strong data-testid="r-multiple" className={outcome.rMultiple >= 0 ? 'positive' : 'negative'}>{signed(outcome.rMultiple)}R</strong></div>
                <div className="table-wrap"><table className="compare-table">
                  <thead><tr><th></th><th>{t('journal.plan')}</th><th>{t('journal.actual')}</th></tr></thead>
                  <tbody>
                    <tr><th>{t('journal.rowPrice')}</th><td>{t('journal.planPrice', { target: price(selected.target), stop: price(selected.stop) })}</td><td>{t('journal.actualPrice', { price: price(outcome.exitPrice) })}</td></tr>
                    <tr><th>R</th><td>+{comparison.plannedRewardR.toFixed(2)}R / -1.00R</td><td>{t('journal.actualR', { r: signed(comparison.realizedR), pct: (comparison.captureRatio * 100).toFixed(0) })}</td></tr>
                    <tr><th>{t('journal.rowZone')}</th><td>—</td><td>{zoneLabel(comparison.zone)}</td></tr>
                    <tr><th>{t('journal.rowReason')}</th><td>{t('journal.planReason', { text: selected.invalidation })}</td><td>{exitLabel(outcome.exitReason)}</td></tr>
                    <tr><th>{t('journal.rowRules')}</th><td>{t('journal.planRules')}</td><td className={outcome.followedPlan ? 'positive' : 'negative'}>{outcome.followedPlan ? t('journal.followed') : t('journal.deviated')}</td></tr>
                  </tbody>
                </table></div>
                <h4>{t('journal.reflection')}</h4>
                <p className="note">{outcome.note || t('journal.noNote')}</p>
                <p className="muted small">{t('journal.manualNote', { date: timestamp(outcome.recordedAt) })}</p>
              </div>
            ) : (
              <>
              <section className="quick-record" aria-label={t('journal.quickAria')} data-testid="quick-record">
                <h3>{t('journal.recordTitle')}</h3>
                <p className="muted small">{t('journal.quickHelp')}</p>
                <div className="quick-buttons">
                  {quickOptions.map((q) => {
                    const r = calculatePaperRMultiple(selected, q.price)
                    return (
                      <button key={q.key} type="button" aria-pressed={quick?.key === q.key} className={'quick-button ' + q.key.toLowerCase() + (quick?.key === q.key ? ' selected' : '')} onClick={() => setQuick(q)}>
                        <strong>{q.label}</strong>
                        <span>{price(q.price)} · {signed(r)}R</span>
                        {pathKey === q.key && <em data-testid="quick-path-badge">{t('journal.pathBadge')}</em>}
                      </button>
                    )
                  })}
                </div>
                {quick && (
                  <div className="quick-confirm" data-testid="quick-confirm" role="group" aria-label={t('journal.confirmAria')}>
                    <p><strong>{quick.label}</strong>{t('journal.confirmTail', { price: price(quick.price), r: signed(calculatePaperRMultiple(selected, quick.price)) })}</p>
                    <label className="check"><input type="checkbox" checked={quickFollowed} onChange={(e) => setQuickFollowed(e.currentTarget.checked)} />{t('journal.followedQuick')}</label>
                    <label>{t('common.memo')}<input maxLength={2000} placeholder={t('journal.memoPh')} value={quickNote} onInput={(e) => setQuickNote(e.currentTarget.value)} /></label>
                    <div className="quick-actions">
                      <button type="button" className="primary" disabled={busy} onClick={() => void recordQuick()}>{busy ? t('journal.recording') : t('journal.confirmButton')}</button>
                      <button type="button" className="secondary" onClick={() => setQuick(null)}>{t('journal.cancel')}</button>
                    </div>
                  </div>
                )}
              </section>
              <form onSubmit={(e) => void saveOutcome(e)} aria-label={t('journal.formAria')}>
                <h4>{t('journal.otherPrice')}</h4>
                <label>{t('journal.exitPrice')}<input name="exitPrice" type="number" required step="any" min="0.001" placeholder={t('journal.exitPricePh')} value={exitPrice} onInput={(e) => setExitPrice(e.currentTarget.value)} /></label>
                <div className="ratio-preview" data-testid="r-preview"><span>{t('journal.rPreview')}</span><strong>{previewR === null ? t('scenario.waiting') : signed(previewR) + 'R'}</strong></div>
                <label>{t('journal.exitReason')}<select value={exitReason} onChange={(e) => setExitReason(e.currentTarget.value as ExitReason)}>
                  {exitReasons.map((k) => <option key={k} value={k}>{exitLabel(k)}</option>)}
                </select></label>
                <label className="check"><input type="checkbox" checked={followedPlan} onChange={(e) => setFollowedPlan(e.currentTarget.checked)} />{t('journal.followedFull')}</label>
                <label>{t('journal.reflectionLabel')}<textarea name="note" rows={4} maxLength={2000} placeholder={t('journal.reflectionPh')} value={note} onInput={(e) => setNote(e.currentTarget.value)} /></label>
                <button className="primary full" type="submit" disabled={busy}>{busy ? t('common.saving') : t('journal.saveOutcome')}</button>
                <p className="muted small">{t('journal.onceOnly')}</p>
              </form>
              </>
            )}
          </div>
          <PathCheck detail={detail} onError={onError} onResult={setPathOutcome} />
          <ReviewGrading detail={detail} pathOutcome={pathOutcome} onSaved={onSaved} onError={onError} onNotice={onNotice} />
        </div>
      )}

      <div className="divider" />
      {scorecard && <Scorecard scorecard={scorecard} />}
      <h3>{t('journal.history')} <span className="muted">{t('journal.paperOnly')}</span></h3>
      {summary && summary.scenarios > 0 && (
        <div className="stat-grid four" data-testid="journal-summary">
          <div className="mini-stat"><span>{t('journal.sumClosed')}</span><strong>{summary.closed} / {summary.scenarios}</strong></div>
          <div className="mini-stat"><span>{t('journal.sumWinLoss')}</span><strong>{summary.wins} / {summary.losses} / {summary.breakeven}</strong></div>
          <div className="mini-stat"><span>{t('journal.sumR')}</span><strong className={summary.totalR >= 0 ? 'positive' : 'negative'}>{signed(summary.totalR)} / {summary.averageR === null ? '—' : signed(summary.averageR)}</strong></div>
          <div className="mini-stat"><span>{t('journal.sumRules')}</span><strong>{summary.followedPlanRate === null ? '—' : (summary.followedPlanRate * 100).toFixed(0) + '%'}</strong></div>
        </div>
      )}
      {loading ? null : entries.length === 0 ? <div className="empty short">{t('journal.noRecords')}</div> : (
        <div className="table-wrap"><table className="responsive" data-testid="journal-table">
          <thead><tr><th>{t('common.col.created')}</th><th>{t('common.col.side')}</th><th>Entry</th><th>{t('journal.plannedRr')}</th><th>{t('journal.col.aiReviews')}</th><th>{t('journal.col.graded')}</th><th>{t('journal.col.paperExit')}</th><th>{t('journal.col.rMultiple')}</th><th>{t('journal.col.rules')}</th></tr></thead>
          <tbody>{entries.map((e) => (
            <tr key={e.scenario.id} className={selected?.id === e.scenario.id ? 'selected' : ''} onClick={() => onOpen(e.scenario.id)}>
              <td data-label={t('common.col.created')}><button className="link-button" type="button">{timestamp(e.scenario.createdAt)}</button></td>
              <td data-label={t('common.col.side')}><span className={'side ' + (e.scenario.side === 'LONG' ? 'long' : 'short-side')}>{e.scenario.side}</span> <span className="muted">{e.scenario.timeframe}</span></td>
              <td data-label="Entry">{price(e.scenario.entry)}</td>
              <td data-label={t('journal.plannedRr')}>1:{e.scenario.riskReward.toFixed(2)}</td>
              <td data-label={t('journal.col.aiReviews')}>{e.reviewCounts.total ? `${e.reviewCounts.bull}↑ ${e.reviewCounts.bear}↓ (${e.reviewCounts.providers.map((p) => providerLabels[p]).join(', ')})` : '—'}</td>
              <td data-label={t('journal.col.graded')}>{e.reviewCounts.total ? <span className={e.outcome && e.reviewCounts.graded < e.reviewCounts.total ? 'warn' : ''}>{e.reviewCounts.graded}/{e.reviewCounts.total}</span> : '—'}</td>
              <td data-label={t('journal.col.paperExit')}>{e.outcome ? price(e.outcome.exitPrice) : <span className="muted">{t('journal.notRecorded')}</span>}</td>
              <td data-label={t('journal.col.rMultiple')}>{e.outcome ? <strong className={e.outcome.rMultiple >= 0 ? 'positive' : 'negative'}>{signed(e.outcome.rMultiple)}R</strong> : '—'}</td>
              <td data-label={t('journal.col.rules')}>{e.outcome ? (e.outcome.followedPlan ? '✓' : t('journal.deviatedShort')) : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  )
}
