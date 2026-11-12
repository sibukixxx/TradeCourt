import { useState, type FormEvent } from 'react'
import {
  calculatePaperRMultiple,
  comparePlanToOutcome,
  providerLabels,
  type ExitReason,
  type JournalEntry,
  type JournalSummary,
  type ReviewScorecard,
  type PlanComparison,
  type ScenarioDetail,
} from '@tradecourt/core'
import { api } from '../api'
import { getError, price, signed, timestamp } from '../format'
import { ReviewGrading, Scorecard, VerdictBadge } from './ReviewGrading'

const exitReasonLabels: Record<ExitReason, string> = {
  TARGET: '利確価格に到達',
  STOP: '損切り価格に到達',
  INVALIDATED: '無効化条件が発生',
  MANUAL: '裁量で手仕舞い',
}
const zoneLabels: Record<PlanComparison['zone'], string> = {
  BEYOND_TARGET: '利確価格を超えた',
  AT_TARGET: '利確価格どおり',
  BETWEEN: '損切りと利確の間',
  AT_STOP: '損切り価格どおり',
  BEYOND_STOP: '損切りを超えて損失（計画外）',
}

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

  const selected = detail?.scenario
  const exitNum = Number(exitPrice)
  const previewR = selected && exitPrice !== '' && Number.isFinite(exitNum) && exitNum > 0
    ? calculatePaperRMultiple(selected, exitNum) : null
  const outcome = detail?.outcome
  const comparison = selected && outcome ? comparePlanToOutcome(selected, outcome.exitPrice) : null

  async function saveOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || busy) return
    if (!Number.isFinite(exitNum) || exitNum <= 0) { onError('正の仮想終了価格を入力してください'); return }
    setBusy(true)
    try {
      await api.paperOutcome(selected.id, { exitPrice: exitNum, exitReason, followedPlan, note })
      setExitPrice(''); setNote(''); setExitReason('MANUAL'); setFollowedPlan(true)
      await onSaved()
      onNotice('仮想取引の結果を保存しました。これは実際の約定記録ではありません。')
    } catch (e) {
      onError(getError(e))
      await onSaved().catch(() => undefined) // e.g. 409: show the already-recorded outcome
    } finally { setBusy(false) }
  }

  return (
    <section className="panel" aria-labelledby="journal-title">
      <div className="section-head">
        <div><span className="eyebrow">04 / LEARN FROM THE RECORD</span><h2 id="journal-title">Journal</h2><p>当初の仮説・AIレビューと、手動入力の仮想決済結果を比較します。実際の約定・ブローカー記録ではありません。</p></div>
        <span className="tag">PAPER ONLY</span>
      </div>

      {loading ? <div className="empty" aria-busy="true">読み込み中…</div> : !selected ? (
        <div className="empty short">保存済みのシナリオを下の履歴または左の一覧から選択してください。</div>
      ) : (
        <div className="journal-layout">
          <div className="case-summary">
            <span className="eyebrow">IMMUTABLE SNAPSHOT · 当初の仮説</span>
            <h3>{selected.symbol} / {selected.side} / {selected.timeframe}</h3>
            <div className="case-prices"><span>ENTRY <strong>{price(selected.entry)}</strong></span><span>STOP <strong>{price(selected.stop)}</strong></span><span>TARGET <strong>{price(selected.target)}</strong></span><span>計画R:R <strong>1:{selected.riskReward.toFixed(2)}</strong></span></div>
            <p>{selected.thesis}</p>
            <p className="muted">無効化条件: {selected.invalidation}</p>
            <small>記録日: {timestamp(selected.createdAt)}</small>
            <div className="divider thin" />
            <span className="eyebrow">AI REVIEWS · {detail.reviews.length}件（意見のみ）</span>
            {detail.reviews.length === 0 ? <p className="muted small">AIレビューは保存されていません。</p> : (
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
                <h3>仮想取引の結果 <span className="tag small-tag">PAPER</span></h3>
                <div className="outcome-value"><span>R倍率（仮想）</span><strong data-testid="r-multiple" className={outcome.rMultiple >= 0 ? 'positive' : 'negative'}>{signed(outcome.rMultiple)}R</strong></div>
                <div className="table-wrap"><table className="compare-table">
                  <thead><tr><th></th><th>当初の計画</th><th>実際の判断（仮想）</th></tr></thead>
                  <tbody>
                    <tr><th>価格</th><td>利確 {price(selected.target)} / 損切り {price(selected.stop)}</td><td>終了 {price(outcome.exitPrice)}</td></tr>
                    <tr><th>R</th><td>+{comparison.plannedRewardR.toFixed(2)}R / -1.00R</td><td>{signed(comparison.realizedR)}R（計画比 {(comparison.captureRatio * 100).toFixed(0)}%）</td></tr>
                    <tr><th>到達</th><td>—</td><td>{zoneLabels[comparison.zone]}</td></tr>
                    <tr><th>終了理由</th><td>無効化: {selected.invalidation}</td><td>{exitReasonLabels[outcome.exitReason]}</td></tr>
                    <tr><th>ルール遵守</th><td>事前ルールどおり</td><td className={outcome.followedPlan ? 'positive' : 'negative'}>{outcome.followedPlan ? '従った' : '逸脱した'}</td></tr>
                  </tbody>
                </table></div>
                <h4>振り返り</h4>
                <p className="note">{outcome.note || 'メモなし'}</p>
                <p className="muted small">手動入力 / {timestamp(outcome.recordedAt)}。実際の約定・スプレッド・手数料・スワップは含みません。記録は変更できません。</p>
              </div>
            ) : (
              <form onSubmit={(e) => void saveOutcome(e)} aria-label="仮想結果の記録">
                <h3>仮想取引の終了を記録</h3>
                <label>仮想終了価格<input name="exitPrice" type="number" required step="any" min="0.001" placeholder="例: 151.400" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} /></label>
                <div className="ratio-preview" data-testid="r-preview"><span>R倍率（プレビュー）</span><strong>{previewR === null ? '入力待ち' : signed(previewR) + 'R'}</strong></div>
                <label>終了理由<select value={exitReason} onChange={(e) => setExitReason(e.target.value as ExitReason)}>
                  {(Object.keys(exitReasonLabels) as ExitReason[]).map((k) => <option key={k} value={k}>{exitReasonLabels[k]}</option>)}
                </select></label>
                <label className="check"><input type="checkbox" checked={followedPlan} onChange={(e) => setFollowedPlan(e.target.checked)} />事前に決めたルール（損切り・利確・無効化）に従った</label>
                <label>結果の振り返り<textarea name="note" rows={4} maxLength={2000} placeholder="事前ルールに従えたか、想定外は何か、AIの指摘は当たったか..." value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <button className="primary full" type="submit" disabled={busy}>{busy ? '保存中…' : '仮想結果を保存'}</button>
                <p className="muted small">1シナリオにつき1回だけ保存できます（変更不可）。R倍率は値幅のみで算出します。</p>
              </form>
            )}
          </div>
          <ReviewGrading detail={detail} onSaved={onSaved} onError={onError} onNotice={onNotice} />
        </div>
      )}

      <div className="divider" />
      {scorecard && <Scorecard scorecard={scorecard} />}
      <h3>判断履歴 <span className="muted">仮想取引のみ</span></h3>
      {summary && summary.scenarios > 0 && (
        <div className="stat-grid four" data-testid="journal-summary">
          <div className="mini-stat"><span>記録済み / 全シナリオ</span><strong>{summary.closed} / {summary.scenarios}</strong></div>
          <div className="mini-stat"><span>勝ち / 負け / ±0</span><strong>{summary.wins} / {summary.losses} / {summary.breakeven}</strong></div>
          <div className="mini-stat"><span>合計R / 平均R</span><strong className={summary.totalR >= 0 ? 'positive' : 'negative'}>{signed(summary.totalR)} / {summary.averageR === null ? '—' : signed(summary.averageR)}</strong></div>
          <div className="mini-stat"><span>ルール遵守率</span><strong>{summary.followedPlanRate === null ? '—' : (summary.followedPlanRate * 100).toFixed(0) + '%'}</strong></div>
        </div>
      )}
      {loading ? null : entries.length === 0 ? <div className="empty short">まだ記録がありません。</div> : (
        <div className="table-wrap"><table className="responsive" data-testid="journal-table">
          <thead><tr><th>作成</th><th>方向</th><th>Entry</th><th>計画R:R</th><th>AIレビュー</th><th>採点</th><th>仮想終了</th><th>R倍率</th><th>遵守</th></tr></thead>
          <tbody>{entries.map((e) => (
            <tr key={e.scenario.id} className={selected?.id === e.scenario.id ? 'selected' : ''} onClick={() => onOpen(e.scenario.id)}>
              <td data-label="作成"><button className="link-button" type="button">{timestamp(e.scenario.createdAt)}</button></td>
              <td data-label="方向"><span className={'side ' + (e.scenario.side === 'LONG' ? 'long' : 'short-side')}>{e.scenario.side}</span> <span className="muted">{e.scenario.timeframe}</span></td>
              <td data-label="Entry">{price(e.scenario.entry)}</td>
              <td data-label="計画R:R">1:{e.scenario.riskReward.toFixed(2)}</td>
              <td data-label="AIレビュー">{e.reviewCounts.total ? `${e.reviewCounts.bull}↑ ${e.reviewCounts.bear}↓ (${e.reviewCounts.providers.map((p) => providerLabels[p]).join(', ')})` : '—'}</td>
              <td data-label="採点">{e.reviewCounts.total ? <span className={e.outcome && e.reviewCounts.graded < e.reviewCounts.total ? 'warn' : ''}>{e.reviewCounts.graded}/{e.reviewCounts.total}</span> : '—'}</td>
              <td data-label="仮想終了">{e.outcome ? price(e.outcome.exitPrice) : <span className="muted">未記録</span>}</td>
              <td data-label="R倍率">{e.outcome ? <strong className={e.outcome.rMultiple >= 0 ? 'positive' : 'negative'}>{signed(e.outcome.rMultiple)}R</strong> : '—'}</td>
              <td data-label="遵守">{e.outcome ? (e.outcome.followedPlan ? '✓' : '逸脱') : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  )
}
