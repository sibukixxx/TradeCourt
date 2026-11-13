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
import { getLang, t } from '../i18n'

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
        <span className={'side ' + (review.role === 'BULL' ? 'long' : 'short-side')}>{review.role === 'BULL' ? t('common.role.bull') : t('common.role.bear')}</span>
      </div>
      <p>{review.content}</p>
      <small>{t('court.answeredSaved', { responded: timestamp(review.respondedAt), saved: timestamp(review.createdAt) })}</small>
      {review.grade && <div className="card-verdict">{t('court.grade')} <VerdictBadge verdict={review.grade.verdict} />{review.grade.note && <span className="muted"> {review.grade.note}</span>}</div>}
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

  if (loading) return <section className="panel"><div className="empty" aria-busy="true">{t('common.loading')}</div></section>
  const selected = detail?.scenario
  const prompt = selected ? buildReviewPrompt(selected, role, getLang()) : ''

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(role)
      onNotice(t('court.copied', { role, provider: aiProviders[provider].label }))
    } catch {
      promptRef.current?.select()
      onError(t('court.copyFailed'))
    }
  }

  async function saveReview(event: Event) {
    event.preventDefault()
    if (!selected || busy) return
    if (reviewText.trim().length < 10) { onError(t('court.tooShort')); return }
    setBusy(true)
    requestKey.current ??= newRequestKey()
    try {
      const at = respondedAt ? new Date(respondedAt).toISOString() : undefined
      await api.review(selected.id, { provider, role, content: reviewText, respondedAt: at }, requestKey.current)
      requestKey.current = null
      setReviewText('')
      setRespondedAt(localDateTimeNow())
      await onSaved()
      onNotice(t('court.savedNotice', { provider: aiProviders[provider].label, role }))
    } catch (e) { onError(getError(e)) }
    finally { setBusy(false) }
  }

  const reviews = detail?.reviews ?? []
  const bull = reviews.filter((r) => r.role === 'BULL')
  const bear = reviews.filter((r) => r.role === 'BEAR')

  return (
    <section className="panel" aria-labelledby="court-title">
      <div className="section-head">
        <div><span className="eyebrow">03 / ADVERSARIAL REVIEW</span><h2 id="court-title">AI Court</h2><p>{t('court.intro')}</p></div>
        <span className="tag">NO AI API KEYS</span>
      </div>
      {!selected ? <div className="empty">{t('court.noScenario')}</div> : (
        <>
          <div className="court-grid">
            <div className="court-main">
              <div className="case-summary" data-testid="court-case">
                <div className="case-title"><strong>{selected.symbol} · {selected.side}</strong><span>{selected.timeframe} · R:R 1:{selected.riskReward.toFixed(2)}</span></div>
                <div className="case-prices"><span>ENTRY <strong>{price(selected.entry)}</strong></span><span>STOP <strong>{price(selected.stop)}</strong></span><span>TARGET <strong>{price(selected.target)}</strong></span></div>
                <p>{selected.thesis}</p>
                <div className="muted small">{t('common.invalidation', { text: selected.invalidation })}</div>
                {selected.marketRef && <div className="muted small" data-testid="court-as-of">{t('court.asOf', { date: selected.marketRef.asOfDate })}</div>}
              </div>
              <h3>{t('court.step1')}</h3>
              <div className="role-switch" role="group" aria-label={t('court.roleAria')}>
                <button type="button" aria-pressed={role === 'BULL'} className={role === 'BULL' ? 'selected' : ''} onClick={() => setRole('BULL')}>{t('court.bullButton')}</button>
                <button type="button" aria-pressed={role === 'BEAR'} className={role === 'BEAR' ? 'selected' : ''} onClick={() => setRole('BEAR')}>{t('court.bearButton')}</button>
              </div>
              <textarea ref={promptRef} className="prompt-preview" readOnly value={prompt} rows={12} aria-label={t('court.promptAria')} data-testid="prompt" />
              <h3 className="step">{t('court.step2')}</h3>
              <div className="prompt-controls">
                <select aria-label={t('court.askProvider')} value={provider} onChange={(e) => setProvider(e.currentTarget.value as ProviderKey)}>
                  {providerKeys.map((key) => <option key={key} value={key}>{aiProviders[key].label}</option>)}
                </select>
                <button className="primary" type="button" onClick={() => void copyPrompt()}>{copied === role ? t('court.copiedButton') : t('court.copyButton')}</button>
                <a className="external-button" data-testid="open-ai" target="_blank" rel="noopener noreferrer" href={aiProviders[provider].url}>{t('court.open', { provider: aiProviders[provider].label })}</a>
              </div>
              <p className="muted small">{t('court.noAutomation')}</p>
            </div>
            <div className="review-panel">
              <h3>{t('court.step3')}</h3>
              <form onSubmit={(e) => void saveReview(e)} aria-label={t('court.formAria')}>
                <div className="form-grid two">
                  <label>{t('court.answeredProvider')}<select value={provider} onChange={(e) => { requestKey.current = null; setProvider(e.currentTarget.value as ProviderKey) }}>
                    {providerKeys.map((key) => <option key={key} value={key}>{aiProviders[key].label}</option>)}
                  </select></label>
                  <label>{t('court.role')}<select value={role} onChange={(e) => { requestKey.current = null; setRole(e.currentTarget.value as Role) }}>
                    <option value="BULL">{t('common.role.bull')}</option><option value="BEAR">{t('common.role.bear')}</option>
                  </select></label>
                </div>
                <label>{t('court.respondedAt')}<input type="datetime-local" value={respondedAt} max={localDateTimeNow()} onInput={(e) => setRespondedAt(e.currentTarget.value)} /></label>
                <label>{t('court.answer')}<textarea name="review" required minLength={10} maxLength={20000} rows={8} placeholder={t('court.answerPh')} value={reviewText} onInput={(e) => { requestKey.current = null; setReviewText(e.currentTarget.value) }} /></label>
                <button className="primary full" disabled={busy} type="submit">{busy ? t('common.saving') : t('court.save')}</button>
              </form>
              <p className="muted small">{t('court.opinionNote')}</p>
            </div>
          </div>

          <div className="divider" />
          <div className="compare-head">
            <h3>{t('court.compare')} <span className="muted">{t('common.count', { n: reviews.length })}</span></h3>
            <div className="matrix" data-testid="review-matrix">
              {providerKeys.map((key) => {
                const b = bull.filter((r) => r.provider === key).length
                const r = bear.filter((x) => x.provider === key).length
                return <span key={key} className={b + r ? 'has' : ''}>{aiProviders[key].label}<em>{b}↑ {r}↓</em></span>
              })}
            </div>
          </div>
          {reviews.length === 0 ? <p className="empty short">{t('court.noReviews')}</p> : (
            <div className="compare-grid" data-testid="review-compare">
              <div><h4 className="long">{t('court.bullColumn', { n: bull.length })}</h4>{bull.length ? bull.map((r) => <ReviewCard key={r.id} review={r} />) : <p className="muted small">{t('court.notSaved')}</p>}</div>
              <div><h4 className="short-side">{t('court.bearColumn', { n: bear.length })}</h4>{bear.length ? bear.map((r) => <ReviewCard key={r.id} review={r} />) : <p className="muted small">{t('court.notSaved')}</p>}</div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
