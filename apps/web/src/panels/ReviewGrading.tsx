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

export const verdictLabels: Record<Verdict, string> = { HIT: '的中', MISS: '外れ', UNCLEAR: '判定不能' }
const verdictOrder: Verdict[] = ['HIT', 'MISS', 'UNCLEAR']

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={'verdict-badge ' + verdict.toLowerCase()} data-testid="verdict-badge">{verdictLabels[verdict]}</span>
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
  const roleLabel = review.role === 'BULL' ? 'BULL / 賛成' : 'BEAR / 反対'

  async function save() {
    setBusy(true)
    try {
      await api.gradeReview(scenarioId, review.id, { verdict, note })
      await onSaved()
      onNotice(`${providerLabels[review.provider]}の${review.role}レビューを「${verdictLabels[verdict]}」として採点しました。`)
    } catch (e) { onError(getError(e)) }
    finally { setBusy(false) }
  }

  return (
    <article className="grade-card" data-testid="grade-card" aria-label={`${providerLabels[review.provider]} ${roleLabel} の採点`}>
      <div className="grade-card-head">
        <strong>{providerLabels[review.provider]}</strong>
        <span className={'side ' + (review.role === 'BULL' ? 'long' : 'short-side')}>{roleLabel}</span>
        {review.grade ? <VerdictBadge verdict={review.grade.verdict} /> : <span className="pending-badge">未採点</span>}
      </div>
      <details className="grade-content">
        <summary>{review.content}</summary>
        <p>{review.content}</p>
      </details>
      <div className="verdict-buttons" role="group" aria-label="判定">
        {verdictOrder.map((v) => (
          <button key={v} type="button" aria-pressed={verdict === v} className={'verdict-button ' + v.toLowerCase() + (verdict === v ? ' selected' : '')} onClick={() => setVerdict(v)}>
            {verdictLabels[v]}
            {(v === fromResult || v === fromPath) && (
              <small>{[v === fromPath ? '値動き' : null, v === fromResult ? '結果' : null].filter(Boolean).join('・')}より</small>
            )}
          </button>
        ))}
      </div>
      <label className="grade-note">メモ（任意）<input maxLength={1000} placeholder="何が当たった／外れたか" value={note} onInput={(e) => setNote(e.currentTarget.value)} /></label>
      <div className="grade-footer">
        <span className="muted small">{review.grade ? `採点 ${timestamp(review.grade.gradedAt)}` : `提案は仮想結果${signed(rMultiple)}R${fromPath ? '・取込CSVの値動き' : ''}からの自動推定です`}</span>
        <button type="button" className="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? '保存中…' : review.grade ? (dirty ? '採点を更新' : '保存済み') : '採点を保存'}
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
        <h3 id="grading-title">AIレビューの答え合わせ</h3>
        {reviews.length > 0 && <span className="muted small" data-testid="grading-progress">採点済み {graded} / {reviews.length}</span>}
      </div>
      {reviews.length === 0 ? (
        <p className="muted small">このシナリオにはAIレビューがありません。AI Courtで回答を保存すると、結果と照合できます。</p>
      ) : !outcome ? (
        <p className="empty short" data-testid="grading-locked">仮想取引の結果を記録すると、各AIの指摘が当たったかを採点できます。</p>
      ) : (
        <>
          <p className="muted small">結果を見たうえで、各AIの主張が当たったかを自分で判定します（提案:「結果より」は利益ならBULL的中・損失ならBEAR的中、「値動きより」は取込CSVで利確先行ならBULL的中・損切り先行ならBEAR的中。両方ある場合は値動きを優先して初期選択）。これはあなたの主観的な評価で、市場による検証ではありません。採点は後から変更できます。</p>
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
      <h3 id="scorecard-title">AI別の的中率 <span className="muted">自己採点・仮想取引ベース</span></h3>
      <div className="stat-grid four">
        <div className="mini-stat"><span>全体の的中率</span><strong data-testid="overall-hit-rate">{pct(o.hitRate)}</strong><small>的中 {o.hit} / 外れ {o.miss}（判定不能 {o.unclear} は除外）</small></div>
        <div className="mini-stat"><span>採点済み / レビュー</span><strong>{o.graded} / {o.reviews}</strong></div>
        <div className="mini-stat"><span>採点待ち</span><strong data-testid="awaiting-grade" className={scorecard.awaitingGrade ? 'warn' : ''}>{scorecard.awaitingGrade}</strong><small>結果記録済みで未採点</small></div>
        <div className="mini-stat"><span>BEARの警告が当たった負け</span><strong data-testid="warned-losses" className={scorecard.lossesWarnedByBear ? 'negative' : ''}>{scorecard.lossesWarnedByBear}</strong><small>反対意見を活かせたか</small></div>
      </div>
      <div className="table-wrap"><table className="scorecard-table" data-testid="scorecard-table">
        <thead><tr><th>AI</th><th>役割</th><th>レビュー</th><th className="hide-sm">的中</th><th className="hide-sm">外れ</th><th className="hide-sm">判定不能</th><th>的中率</th></tr></thead>
        <tbody>{scorecard.cells.map((c) => (
          <tr key={c.provider + c.role} className="static">
            <td><strong>{providerLabels[c.provider]}</strong></td>
            <td><span className={'side ' + (c.role === 'BULL' ? 'long' : 'short-side')}>{c.role}</span></td>
            <td>{c.reviews}<span className="muted">（採点 {c.graded}）</span></td>
            <td className="hide-sm">{c.hit}</td>
            <td className="hide-sm">{c.miss}</td>
            <td className="hide-sm">{c.unclear}</td>
            <td><span className="rate-bar" style={`--rate: ${c.hitRate ?? 0}`}>{pct(c.hitRate)}</span><span className="show-sm muted"> {c.hit}/{c.hit + c.miss}</span></td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="muted small">件数が少ないうちは的中率のばらつきが大きく、AIの優劣を示すものではありません。</p>
    </section>
  )
}
