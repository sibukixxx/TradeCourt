import { useRef, useState } from 'preact/hooks'
import {
  aiProviders,
  buildReviewPrompt,
  providerLabels,
  type Review,
  type Role,
  type ScenarioDetail,
} from '@tradecourt/core'
import { api, newRequestKey } from '../api'
import { getError, localDateTimeNow, price, timestamp } from '../format'
import { VerdictBadge } from './ReviewGrading'

type ProviderKey = keyof typeof aiProviders
const providerKeys = Object.keys(aiProviders) as ProviderKey[]

type Props = {
  detail: ScenarioDetail | null
  loading: boolean
  onSaved: () => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function ReviewCard({ review }: { review: Review }) {
  // AI text is untrusted. It is rendered as a React text node only (never innerHTML / markdown).
  return (
    <article className="review-card" data-testid="review-card">
      <div>
        <strong>{providerLabels[review.provider]}</strong>
        <span className={'side ' + (review.role === 'BULL' ? 'long' : 'short-side')}>{review.role === 'BULL' ? 'BULL / 賛成' : 'BEAR / 反対'}</span>
      </div>
      <p>{review.content}</p>
      <small>回答日時 {timestamp(review.respondedAt)} · 保存 {timestamp(review.createdAt)} · 手動貼付（未検証の意見）</small>
      {review.grade && <div className="card-verdict">答え合わせ: <VerdictBadge verdict={review.grade.verdict} />{review.grade.note && <span className="muted"> {review.grade.note}</span>}</div>}
    </article>
  )
}

export function CourtPanel({ detail, loading, onSaved, onError, onNotice }: Props) {
  const [provider, setProvider] = useState<ProviderKey>('chatgpt')
  const [role, setRole] = useState<Role>('BEAR')
  const [reviewText, setReviewText] = useState('')
  const [respondedAt, setRespondedAt] = useState(localDateTimeNow)
  const [copied, setCopied] = useState<Role | null>(null)
  const [busy, setBusy] = useState(false)
  const requestKey = useRef<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  if (loading) return <section className="panel"><div className="empty" aria-busy="true">読み込み中…</div></section>
  const selected = detail?.scenario
  const prompt = selected ? buildReviewPrompt(selected, role) : ''

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(role)
      onNotice(`${role}プロンプトをコピーしました。${aiProviders[provider].label}の公式サイトに手動で貼り付けてください。`)
    } catch {
      promptRef.current?.select()
      onError('クリップボードにコピーできません。プロンプト欄を選択済みにしたので、手動でコピーしてください。')
    }
  }

  async function saveReview(event: Event) {
    event.preventDefault()
    if (!selected || busy) return
    if (reviewText.trim().length < 10) { onError('AIの回答は10文字以上で貼り付けてください'); return }
    setBusy(true)
    requestKey.current ??= newRequestKey()
    try {
      const at = respondedAt ? new Date(respondedAt).toISOString() : undefined
      await api.review(selected.id, { provider, role, content: reviewText, respondedAt: at }, requestKey.current)
      requestKey.current = null
      setReviewText('')
      setRespondedAt(localDateTimeNow())
      await onSaved()
      onNotice(`${aiProviders[provider].label}の${role}回答を「手動貼付レビュー」として保存しました。`)
    } catch (e) { onError(getError(e)) }
    finally { setBusy(false) }
  }

  const reviews = detail?.reviews ?? []
  const bull = reviews.filter((r) => r.role === 'BULL')
  const bear = reviews.filter((r) => r.role === 'BEAR')

  return (
    <section className="panel" aria-labelledby="court-title">
      <div className="section-head">
        <div><span className="eyebrow">03 / ADVERSARIAL REVIEW</span><h2 id="court-title">AI Court</h2><p>保存済みシナリオから反証プロンプトを生成し、契約中のAIの公式サイトで手動で質問します。回答は貼り付けて保存します。</p></div>
        <span className="tag">NO AI API KEYS</span>
      </div>
      {!selected ? <div className="empty">最初にScenario画面で仮説を保存するか、履歴からシナリオを選択してください。</div> : (
        <>
          <div className="court-grid">
            <div className="court-main">
              <div className="case-summary" data-testid="court-case">
                <div className="case-title"><strong>{selected.symbol} · {selected.side}</strong><span>{selected.timeframe} · R:R 1:{selected.riskReward.toFixed(2)}</span></div>
                <div className="case-prices"><span>ENTRY <strong>{price(selected.entry)}</strong></span><span>STOP <strong>{price(selected.stop)}</strong></span><span>TARGET <strong>{price(selected.target)}</strong></span></div>
                <p>{selected.thesis}</p>
                <div className="muted small">無効化条件: {selected.invalidation}</div>
              </div>
              <h3>1. 役割を選んでプロンプトを生成</h3>
              <div className="role-switch" role="group" aria-label="AIの役割">
                <button type="button" aria-pressed={role === 'BULL'} className={role === 'BULL' ? 'selected' : ''} onClick={() => setRole('BULL')}>賛成側 / BULL</button>
                <button type="button" aria-pressed={role === 'BEAR'} className={role === 'BEAR' ? 'selected' : ''} onClick={() => setRole('BEAR')}>反対側 / BEAR</button>
              </div>
              <textarea ref={promptRef} className="prompt-preview" readOnly value={prompt} rows={12} aria-label="生成したAI審査プロンプト" data-testid="prompt" />
              <h3 className="step">2. コピーして公式AIで質問</h3>
              <div className="prompt-controls">
                <select aria-label="質問するAIサービス" value={provider} onChange={(e) => setProvider(e.currentTarget.value as ProviderKey)}>
                  {providerKeys.map((key) => <option key={key} value={key}>{aiProviders[key].label}</option>)}
                </select>
                <button className="primary" type="button" onClick={() => void copyPrompt()}>{copied === role ? 'コピー済み ✓' : 'プロンプトをコピー'}</button>
                <a className="external-button" data-testid="open-ai" target="_blank" rel="noopener noreferrer" href={aiProviders[provider].url}>{aiProviders[provider].label} を開く ↗</a>
              </div>
              <p className="muted small">外部AIへの送信・ログイン・回答取得は自動化しません。認証情報やCookieにも触れません。サブスクリプションはAPI利用権ではありません。</p>
            </div>
            <div className="review-panel">
              <h3>3. 回答を手動で保存</h3>
              <form onSubmit={(e) => void saveReview(e)} aria-label="AI回答の保存">
                <div className="form-grid two">
                  <label>回答したAIサービス<select value={provider} onChange={(e) => { requestKey.current = null; setProvider(e.currentTarget.value as ProviderKey) }}>
                    {providerKeys.map((key) => <option key={key} value={key}>{aiProviders[key].label}</option>)}
                  </select></label>
                  <label>役割<select value={role} onChange={(e) => { requestKey.current = null; setRole(e.currentTarget.value as Role) }}>
                    <option value="BULL">BULL / 賛成</option><option value="BEAR">BEAR / 反対</option>
                  </select></label>
                </div>
                <label>回答日時<input type="datetime-local" value={respondedAt} max={localDateTimeNow()} onInput={(e) => setRespondedAt(e.currentTarget.value)} /></label>
                <label>AIの回答（貼り付け）<textarea name="review" required minLength={10} maxLength={20000} rows={8} placeholder="契約中のAIからの回答をコピーして貼り付ける..." value={reviewText} onInput={(e) => { requestKey.current = null; setReviewText(e.currentTarget.value) }} /></label>
                <button className="primary full" disabled={busy} type="submit">{busy ? '保存中…' : '審査記録を保存'}</button>
              </form>
              <p className="muted small">貼り付けた回答は「AIの意見」であり、検証済みの市場データではありません。HTMLとしては表示しません。</p>
            </div>
          </div>

          <div className="divider" />
          <div className="compare-head">
            <h3>レビュー比較 <span className="muted">{reviews.length}件</span></h3>
            <div className="matrix" data-testid="review-matrix">
              {providerKeys.map((key) => {
                const b = bull.filter((r) => r.provider === key).length
                const r = bear.filter((x) => x.provider === key).length
                return <span key={key} className={b + r ? 'has' : ''}>{aiProviders[key].label}<em>{b}↑ {r}↓</em></span>
              })}
            </div>
          </div>
          {reviews.length === 0 ? <p className="empty short">まだ保存された回答はありません。BULLとBEARの両方を保存すると並べて比較できます。</p> : (
            <div className="compare-grid" data-testid="review-compare">
              <div><h4 className="long">BULL / 賛成側 ({bull.length})</h4>{bull.length ? bull.map((r) => <ReviewCard key={r.id} review={r} />) : <p className="muted small">未保存</p>}</div>
              <div><h4 className="short-side">BEAR / 反対側 ({bear.length})</h4>{bear.length ? bear.map((r) => <ReviewCard key={r.id} review={r} />) : <p className="muted small">未保存</p>}</div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
