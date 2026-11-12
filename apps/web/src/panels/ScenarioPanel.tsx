import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { calculateRiskReward, scenarioInputSchema, type MarketDataset, type MarketDatasetMeta, type Scenario } from '@tradecourt/core'
import { api, newRequestKey } from '../api'
import { getError, price, timestamp } from '../format'
import { PriceChart } from '../components/PriceChart'

type Draft = {
  timeframe: '1h' | '4h' | '1d'
  side: 'LONG' | 'SHORT'
  entry: string
  stop: string
  target: string
  thesis: string
  invalidation: string
  /** Optional market link: '' = not linked. */
  datasetId: string
  asOfDate: string
}
const blankDraft: Draft = { timeframe: '4h', side: 'LONG', entry: '', stop: '', target: '', thesis: '', invalidation: '', datasetId: '', asOfDate: '' }
const MAX_AS_OF_OPTIONS = 500

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
  const [datasets, setDatasets] = useState<MarketDatasetMeta[]>([])
  const [linked, setLinked] = useState<MarketDataset | null>(null)
  useEffect(() => {
    api.datasets().then(({ datasets: list }) => setDatasets(list)).catch((e: unknown) => onError(getError(e)))
  }, [onError])
  useEffect(() => {
    let current = true
    if (!draft.datasetId) { setLinked(null); return }
    api.dataset(draft.datasetId).then(({ dataset }) => {
      if (!current) return
      setLinked(dataset)
      // Default as-of: the latest candle of the chosen dataset.
      setDraft((old) => (old.asOfDate ? old : { ...old, asOfDate: dataset.candles[dataset.candles.length - 1].date }))
    }).catch((e: unknown) => current && onError(getError(e)))
    return () => { current = false }
  }, [draft.datasetId, onError])

  const parsed = useMemo(() => scenarioInputSchema.safeParse({
    symbol: 'USDJPY',
    timeframe: draft.timeframe,
    side: draft.side,
    entry: draft.entry === '' ? NaN : Number(draft.entry),
    stop: draft.stop === '' ? NaN : Number(draft.stop),
    target: draft.target === '' ? NaN : Number(draft.target),
    thesis: draft.thesis,
    invalidation: draft.invalidation,
    ...(draft.datasetId && draft.asOfDate ? { marketRef: { datasetId: draft.datasetId, asOfDate: draft.asOfDate } } : {}),
  }), [draft])
  const asOfIndex = linked ? linked.candles.findIndex((c) => c.date === draft.asOfDate) : -1
  const asOfCandle = asOfIndex >= 0 && linked ? linked.candles[asOfIndex] : null
  // R:R preview depends only on the three prices and direction, not on the text fields.
  const nums = [draft.entry, draft.stop, draft.target].map((v) => (v === '' ? NaN : Number(v)))
  const [entry, stop, target] = nums
  const pricesValid = nums.every((n) => Number.isFinite(n) && n > 0)
  const directional = pricesValid && (draft.side === 'LONG' ? stop < entry && target > entry : target < entry && stop > entry)
  const ratio = directional ? calculateRiskReward({ entry, stop, target }) : null
  const directionIssue = pricesValid && !directional
  const asOfOptions = linked ? linked.candles.slice(-MAX_AS_OF_OPTIONS).map((c) => c.date).reverse() : []

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    requestKey.current = null // a changed draft is a new submission
    setDraft((old) => ({ ...old, [key]: value }))
  }

  async function submit(event: Event) {
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
          <label>時間足<select name="timeframe" value={draft.timeframe} onChange={(e) => patch('timeframe', e.currentTarget.value as Draft['timeframe'])}>
            <option value="1h">1時間</option><option value="4h">4時間</option><option value="1d">日足</option>
          </select></label>
          <fieldset className="side-toggle">
            <legend>方向</legend>
            <label className={draft.side === 'LONG' ? 'on long' : ''}><input type="radio" name="side" value="LONG" checked={draft.side === 'LONG'} onChange={() => patch('side', 'LONG')} />LONG / 買い</label>
            <label className={draft.side === 'SHORT' ? 'on short-side' : ''}><input type="radio" name="side" value="SHORT" checked={draft.side === 'SHORT'} onChange={() => patch('side', 'SHORT')} />SHORT / 売り</label>
          </fieldset>
        </div>
        <fieldset className="market-link" data-testid="market-link">
          <legend>相場データに紐付け（任意）</legend>
          <div className="form-grid two">
            <label>取込済みCSV<select name="datasetId" value={draft.datasetId} onChange={(e) => { patch('asOfDate', ''); patch('datasetId', e.currentTarget.value) }}>
              <option value="">紐付けない</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.sourceName} · {d.timeframe} · {d.firstDate}→{d.lastDate}</option>)}
            </select></label>
            <label>仮説時点（この足の終値時点）<select name="asOfDate" value={draft.asOfDate} disabled={!linked} onChange={(e) => patch('asOfDate', e.currentTarget.value)}>
              {!linked && <option value="">—</option>}
              {asOfOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select></label>
          </div>
          {datasets.length === 0 && <p className="muted small">Market LensでCSVを取り込むと、仮説を立てた時点の足に紐付けられます。後から取り込んだCSVで「損切りと利確のどちらに先に届いたか」を照合できます。</p>}
          {linked && asOfCandle && (
            <>
              <div className="as-of-hint">
                <span>仮説時点の足の終値（CSV）<strong data-testid="as-of-close">{price(asOfCandle.close)}</strong></span>
                <button type="button" className="secondary" onClick={() => patch('entry', String(asOfCandle.close))}>Entryに使う</button>
              </div>
              <PriceChart
                candles={linked.candles.slice(Math.max(0, asOfIndex - 59), asOfIndex + 1)}
                label="仮説時点までの終値（CSV）"
                levels={directional ? { entry, stop, target } : undefined}
                testId="link-chart"
              ranges
              />
              <p className="muted small">紐付けは保存後に変更できません。仮説時点より後の足は、照合（Journal）でのみ使います。</p>
            </>
          )}
        </fieldset>
        <div className="form-grid price-grid">
          <label>Entry / 仮説価格<input name="entry" type="number" inputMode="decimal" step="any" min="0.001" placeholder="150.200" required value={draft.entry} onInput={(e) => patch('entry', e.currentTarget.value)} /></label>
          <label>Stop / 損切り<input name="stop" type="number" inputMode="decimal" step="any" min="0.001" placeholder="149.600" required value={draft.stop} onInput={(e) => patch('stop', e.currentTarget.value)} /></label>
          <label>Target / 利確<input name="target" type="number" inputMode="decimal" step="any" min="0.001" placeholder="151.400" required value={draft.target} onInput={(e) => patch('target', e.currentTarget.value)} /></label>
        </div>
        <div className={'ratio-preview' + (directionIssue ? ' invalid' : '')} data-testid="rr-preview" aria-live="polite">
          <span>想定リスクリワード</span>
          <strong>{ratio !== null ? '1 : ' + ratio.toFixed(2) : directionIssue ? '方向が不正' : '入力待ち'}</strong>
          <span>{draft.side === 'LONG' ? 'LONG: Stop < Entry < Target' : 'SHORT: Target < Entry < Stop'}</span>
        </div>
        <label>エントリーの根拠（12文字以上）<textarea name="thesis" required minLength={12} maxLength={2000} rows={3} placeholder="具体的な根拠。現時点で確認できていない点も書いてください。" value={draft.thesis} onInput={(e) => patch('thesis', e.currentTarget.value)} /></label>
        <label>この仮説が無効になる条件（5文字以上）<textarea name="invalidation" required minLength={5} maxLength={1000} rows={2} placeholder="例：特定価格を終値で割った場合" value={draft.invalidation} onInput={(e) => patch('invalidation', e.currentTarget.value)} /></label>
        <div className="form-footer"><span>発注は行いません。保存後、AIに反証を依頼できます。</span><button className="primary" type="submit" disabled={busy}>{busy ? '保存中…' : 'Save & challenge →'}</button></div>
      </form>

      <div className="divider" />
      <h3>保存済みシナリオ <span className="muted">{scenarios.length}</span></h3>
      {loading ? <div className="empty short" aria-busy="true">読み込み中…</div>
        : scenarios.length === 0 ? <div className="empty short">まだシナリオがありません。上のフォームから最初の仮説を保存してください。</div>
        : (
          <div className="table-wrap"><table className="responsive" data-testid="scenario-table">
            <thead><tr><th>作成</th><th>方向</th><th>足</th><th>Entry</th><th>Stop</th><th>Target</th><th>R:R</th><th>根拠</th></tr></thead>
            <tbody>{scenarios.map((s) => (
              <tr key={s.id} onClick={() => onOpen(s.id)}>
                <td data-label="作成">{timestamp(s.createdAt)}</td>
                <td data-label="方向"><span className={'side ' + (s.side === 'LONG' ? 'long' : 'short-side')}>{s.side}</span></td>
                <td data-label="足">{s.timeframe}</td><td data-label="Entry">{price(s.entry)}</td><td data-label="Stop">{price(s.stop)}</td><td data-label="Target">{price(s.target)}</td>
                <td data-label="R:R">1:{s.riskReward.toFixed(2)}</td>
                <td data-label="根拠" className="clip"><button className="link-button" type="button">{s.thesis}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
    </section>
  )
}
