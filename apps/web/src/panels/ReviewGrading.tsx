import { useState } from 'preact/hooks'
import {
  providerLabels,
  suggestVerdict,
  suggestVerdictFromPath,
  type PathOutcome,
  type Review,
  type ReviewScorecard,
  type ScenarioDetail,
  type Verdict,
} from '@tradecourt/core'
import { api } from '../api'
import { getError, signed, timestamp } from '../format'
import { t } from '../i18n'

export const verdictLabel = (v: Verdict) => t(`verdict.${v}`)
const verdictOrder: Verdict[] = ['HIT', 'MISS', 'UNCLEAR']

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={'verdict-badge ' + verdict.toLowerCase()} data-testid="verdict-badge">{verdictLabel(verdict)}</span>
}

type CardProps = {
  scenarioId: string
  review: Review
  rMultiple: number
  /** Reference CSV path outcome for linked scenarios (null = unlinked or not loaded). */
  pathOutcome: PathOutcome | null
  onSaved: () => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function GradeCard({ scenarioId, review, rMultiple, pathOutcome, onSaved, onError, onNotice }: CardProps) {
  const fromResult = suggestVerdict(review.role, rMultiple)
  const fromPath = pathOutcome ? suggestVerdictFromPath(review.role, pathOutcome) : null
  // The CSV path (what price did after the hypothesis) is preferred when it decided.
  const [verdict, setVerdict] = useState<Verdict>(review.grade?.verdict ?? fromPath ?? fromResult)
  const [note, setNote] = useState(review.grade?.note ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = !review.grade || review.grade.verdict !== verdict || review.grade.note !== note.trim()
  const roleLabel = review.role === 'BULL' ? t('common.role.bull') : t('common.role.bear')

  async function save() {
    setBusy(true)
    try {
      await api.gradeReview(scenarioId, review.id, { verdict, note })
      await onSaved()
      onNotice(t('grading.notice', { provider: providerLabels[review.provider], role: review.role, verdict: verdictLabel(verdict) }))
    } catch (e) { onError(getError(e)) }
    finally { setBusy(false) }
  }

  return (
    <article className="grade-card" data-testid="grade-card" aria-label={t('grading.cardAria', { provider: providerLabels[review.provider], role: roleLabel })}>
      <div className="grade-card-head">
        <strong>{providerLabels[review.provider]}</strong>
        <span className={'side ' + (review.role === 'BULL' ? 'long' : 'short-side')}>{roleLabel}</span>
        {review.grade ? <VerdictBadge verdict={review.grade.verdict} /> : <span className="pending-badge">{t('grading.pending')}</span>}
      </div>
      <details className="grade-content">
        <summary data-more={t('grading.fullText')}>{review.content}</summary>
        <p>{review.content}</p>
      </details>
      <div className="verdict-buttons" role="group" aria-label={t('grading.verdictAria')}>
        {verdictOrder.map((v) => (
          <button key={v} type="button" aria-pressed={verdict === v} className={'verdict-button ' + v.toLowerCase() + (verdict === v ? ' selected' : '')} onClick={() => setVerdict(v)}>
            {verdictLabel(v)}
            {(v === fromResult || v === fromPath) && (
              <small>{t('grading.from', { sources: [v === fromPath ? t('grading.fromPath') : null, v === fromResult ? t('grading.fromResult') : null].filter(Boolean).join(t('grading.sourceJoin')) })}</small>
            )}
          </button>
        ))}
      </div>
      <label className="grade-note">{t('common.memo')}<input maxLength={1000} placeholder={t('grading.memoPh')} value={note} onInput={(e) => setNote(e.currentTarget.value)} /></label>
      <div className="grade-footer">
        <span className="muted small">{review.grade ? t('grading.gradedAt', { date: timestamp(review.grade.gradedAt) }) : t('grading.suggestion', { r: signed(rMultiple), path: fromPath ? t('grading.suggestionPath') : '' })}</span>
        <button type="button" className="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? t('common.saving') : review.grade ? (dirty ? t('grading.update') : t('grading.saved')) : t('grading.save')}
        </button>
      </div>
    </article>
  )
}

type GradingProps = {
  detail: ScenarioDetail
  onSaved: () => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
  pathOutcome: PathOutcome | null
}

export function ReviewGrading({ detail, pathOutcome, onSaved, onError, onNotice }: GradingProps) {
  const { reviews, outcome, scenario } = detail
  const graded = reviews.filter((r) => r.grade).length
  return (
    <section className="grading" aria-labelledby="grading-title" data-testid="review-grading">
      <div className="grading-head">
        <h3 id="grading-title">{t('grading.title')}</h3>
        {reviews.length > 0 && <span className="muted small" data-testid="grading-progress">{t('grading.progress', { graded, total: reviews.length })}</span>}
      </div>
      {reviews.length === 0 ? (
        <p className="muted small">{t('grading.noReviews')}</p>
      ) : !outcome ? (
        <p className="empty short" data-testid="grading-locked">{t('grading.locked')}</p>
      ) : (
        <>
          <p className="muted small">{t('grading.help')}</p>
          <div className="grade-list">
            {reviews.map((r) => (
              <GradeCard key={r.id + (r.grade?.gradedAt ?? '') + (pathOutcome ?? '')} scenarioId={scenario.id} review={r} rMultiple={outcome.rMultiple} pathOutcome={pathOutcome} onSaved={onSaved} onError={onError} onNotice={onNotice} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)

export function Scorecard({ scorecard }: { scorecard: ReviewScorecard }) {
  if (scorecard.overall.reviews === 0) return null
  const o = scorecard.overall
  return (
    <section className="scorecard" aria-labelledby="scorecard-title" data-testid="scorecard">
      <h3 id="scorecard-title">{t('scorecard.title')} <span className="muted">{t('scorecard.subtitle')}</span></h3>
      <div className="stat-grid four">
        <div className="mini-stat"><span>{t('scorecard.overall')}</span><strong data-testid="overall-hit-rate">{pct(o.hitRate)}</strong><small>{t('scorecard.overallSub', { hit: o.hit, miss: o.miss, unclear: o.unclear })}</small></div>
        <div className="mini-stat"><span>{t('scorecard.gradedOf')}</span><strong>{o.graded} / {o.reviews}</strong></div>
        <div className="mini-stat"><span>{t('scorecard.awaiting')}</span><strong data-testid="awaiting-grade" className={scorecard.awaitingGrade ? 'warn' : ''}>{scorecard.awaitingGrade}</strong><small>{t('scorecard.awaitingSub')}</small></div>
        <div className="mini-stat"><span>{t('scorecard.warned')}</span><strong data-testid="warned-losses" className={scorecard.lossesWarnedByBear ? 'negative' : ''}>{scorecard.lossesWarnedByBear}</strong><small>{t('scorecard.warnedSub')}</small></div>
      </div>
      <div className="table-wrap"><table className="scorecard-table" data-testid="scorecard-table">
        <thead><tr><th>AI</th><th>{t('scorecard.col.role')}</th><th>{t('scorecard.col.reviews')}</th><th className="hide-sm">{verdictLabel('HIT')}</th><th className="hide-sm">{verdictLabel('MISS')}</th><th className="hide-sm">{verdictLabel('UNCLEAR')}</th><th>{t('scorecard.col.rate')}</th></tr></thead>
        <tbody>{scorecard.cells.map((c) => (
          <tr key={c.provider + c.role} className="static">
            <td><strong>{providerLabels[c.provider]}</strong></td>
            <td><span className={'side ' + (c.role === 'BULL' ? 'long' : 'short-side')}>{c.role}</span></td>
            <td>{c.reviews}<span className="muted">{t('scorecard.gradedCount', { n: c.graded })}</span></td>
            <td className="hide-sm">{c.hit}</td>
            <td className="hide-sm">{c.miss}</td>
            <td className="hide-sm">{c.unclear}</td>
            <td><span className="rate-bar" style={`--rate: ${c.hitRate ?? 0}`}>{pct(c.hitRate)}</span><span className="show-sm muted"> {c.hit}/{c.hit + c.miss}</span></td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="muted small">{t('scorecard.smallSample')}</p>
    </section>
  )
}
