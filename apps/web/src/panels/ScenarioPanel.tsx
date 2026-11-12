import { useMemo, useRef, useState, type FormEvent } from 'react'
import { calculateRiskReward, scenarioInputSchema, type Scenario } from '@tradecourt/core'
import { api, newRequestKey } from '../api'
import { getError, price, timestamp } from '../format'

type Draft = {
  timeframe: '1h' | '4h' | '1d'
  side: 'LONG' | 'SHORT'
  entry: string
  stop: string
  target: string
  thesis: string
  invalidation: string
}
const blankDraft: Draft = { timeframe: '4h', side: 'LONG', entry: '', stop: '', target: '', thesis: '', invalidation: '' }

type Props = {
  scenarios: Scenario[]
  loading: boolean
  onCreated: (scenario: Scenario) => void
  onOpen: (id: string) => void
  onError: (message: string) => void
}

export function ScenarioPanel({ scenarios, loading, onCreated, onOpen, onError }: Props) {
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [busy, setBusy] = useState(false)
  const requestKey = useRef<string | null>(null)
  const parsed = useMemo(() => scenarioInputSchema.safeParse({
    symbol: 'USDJPY',
    ...draft,
    entry: draft.entry === '' ? NaN : Number(draft.entry),
    stop: draft.stop === '' ? NaN : Number(draft.stop),
    target: draft.target === '' ? NaN : Number(draft.target),
  }), [draft])
  // R:R preview depends only on the three prices and direction, not on the text fields.
  const nums = [draft.entry, draft.stop, draft.target].map((v) => (v === '' ? NaN : Number(v)))
  const [entry, stop, target] = nums
  const pricesValid = nums.every((n) => Number.isFinite(n) && n > 0)
  const directional = pricesValid && (draft.side === 'LONG' ? stop < entry && target > entry : target < entry && stop > entry)
  const ratio = directional ? calculateRiskReward({ entry, stop, target }) : null
  const directionIssue = pricesValid && !directional

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    requestKey.current = null // a changed draft is a new submission
    setDraft((old) => ({ ...old, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      onError(`${issue?.path.join('.') || '入力'}: ${issue?.message ?? '入力値を確認してください'}`)
      return
    }
    setBusy(true)
    requestKey.current ??= newRequestKey()
    try {
      const { scenario } = await api.create(parsed.data, requestKey.current)
      requestKey.current = null
      setDraft(blankDraft)
      onCreated(scenario)
    } catch (e) { onError(getError(e)) }
    finally { setBusy(false) }
  }

  return (
    <section className="panel" aria-labelledby="scenario-title">
      <div className="section-head">
        <div><span className="eyebrow">02 / STRUCTURE THE THESIS</span><h2 id="scenario-title">New Scenario</h2><p>判断前の仮説を固定します。価格は手動入力です。現在値ではありません。保存後は変更できません。</p></div>
        <span className="tag">USD/JPY · INITIAL SCOPE</span>
      </div>
      <form onSubmit={(e) => void submit(e)} className="scenario-form" aria-label="シナリオ登録">
        <div className="form-grid">
          <label>通貨ペア<input value="USD/JPY" readOnly /></label>
          <label>時間足<select name="timeframe" value={draft.timeframe} onChange={(e) => patch('timeframe', e.target.value as Draft['timeframe'])}>
            <option value="1h">1時間</option><option value="4h">4時間</option><option value="1d">日足</option>
          </select></label>
          <fieldset className="side-toggle">
            <legend>方向</legend>
            <label className={draft.side === 'LONG' ? 'on long' : ''}><input type="radio" name="side" value="LONG" checked={draft.side === 'LONG'} onChange={() => patch('side', 'LONG')} />LONG / 買い</label>
            <label className={draft.side === 'SHORT' ? 'on short-side' : ''}><input type="radio" name="side" value="SHORT" checked={draft.side === 'SHORT'} onChange={() => patch('side', 'SHORT')} />SHORT / 売り</label>
          </fieldset>
        </div>
        <div className="form-grid price-grid">
          <label>Entry / 仮説価格<input name="entry" type="number" inputMode="decimal" step="any" min="0.001" placeholder="150.200" required value={draft.entry} onChange={(e) => patch('entry', e.target.value)} /></label>
          <label>Stop / 損切り<input name="stop" type="number" inputMode="decimal" step="any" min="0.001" placeholder="149.600" required value={draft.stop} onChange={(e) => patch('stop', e.target.value)} /></label>
          <label>Target / 利確<input name="target" type="number" inputMode="decimal" step="any" min="0.001" placeholder="151.400" required value={draft.target} onChange={(e) => patch('target', e.target.value)} /></label>
        </div>
        <div className={'ratio-preview' + (directionIssue ? ' invalid' : '')} data-testid="rr-preview" aria-live="polite">
          <span>想定リスクリワード</span>
          <strong>{ratio !== null ? '1 : ' + ratio.toFixed(2) : directionIssue ? '方向が不正' : '入力待ち'}</strong>
          <span>{draft.side === 'LONG' ? 'LONG: Stop < Entry < Target' : 'SHORT: Target < Entry < Stop'}</span>
        </div>
        <label>エントリーの根拠（12文字以上）<textarea name="thesis" required minLength={12} maxLength={2000} rows={3} placeholder="具体的な根拠。現時点で確認できていない点も書いてください。" value={draft.thesis} onChange={(e) => patch('thesis', e.target.value)} /></label>
        <label>この仮説が無効になる条件（5文字以上）<textarea name="invalidation" required minLength={5} maxLength={1000} rows={2} placeholder="例：特定価格を終値で割った場合" value={draft.invalidation} onChange={(e) => patch('invalidation', e.target.value)} /></label>
        <div className="form-footer"><span>発注は行いません。保存後、AIに反証を依頼できます。</span><button className="primary" type="submit" disabled={busy}>{busy ? '保存中…' : 'Save & challenge →'}</button></div>
      </form>

      <div className="divider" />
      <h3>保存済みシナリオ <span className="muted">{scenarios.length}</span></h3>
      {loading ? <div className="empty short" aria-busy="true">読み込み中…</div>
        : scenarios.length === 0 ? <div className="empty short">まだシナリオがありません。上のフォームから最初の仮説を保存してください。</div>
        : (
          <div className="table-wrap"><table data-testid="scenario-table">
            <thead><tr><th>作成</th><th>方向</th><th>足</th><th>Entry</th><th>Stop</th><th>Target</th><th>R:R</th><th>根拠</th></tr></thead>
            <tbody>{scenarios.map((s) => (
              <tr key={s.id} onClick={() => onOpen(s.id)}>
                <td>{timestamp(s.createdAt)}</td>
                <td><span className={'side ' + (s.side === 'LONG' ? 'long' : 'short-side')}>{s.side}</span></td>
                <td>{s.timeframe}</td><td>{price(s.entry)}</td><td>{price(s.stop)}</td><td>{price(s.target)}</td>
                <td>1:{s.riskReward.toFixed(2)}</td>
                <td className="clip"><button className="link-button" type="button">{s.thesis}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
    </section>
  )
}
