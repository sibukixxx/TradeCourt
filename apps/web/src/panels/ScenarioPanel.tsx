import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { AUTO_DRAFT_PREFIXES, calculateRiskReward, candleTime, draftLevels, scenarioInputSchema, targetForR, type LevelMethod, type MarketDataset, type MarketDatasetMeta, type QuoteProvider, type Scenario } from '@tradecourt/core'
import { api, newRequestKey } from '../api'
import { getError, price, timestamp } from '../format'
import { PriceChart } from '../components/PriceChart'
import { getLang, t } from '../i18n'

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
  /** 'off' hides the optional external quote button. */
  quoteProvider: QuoteProvider
  scenarios: Scenario[]
  loading: boolean
  onCreated: (scenario: Scenario) => void
  onOpen: (id: string) => void
  onError: (message: string) => void
}

export function ScenarioPanel({ quoteProvider, scenarios, loading, onCreated, onOpen, onError }: Props) {
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [busy, setBusy] = useState(false)
  const requestKey = useRef<string | null>(null)
  const [datasets, setDatasets] = useState<MarketDatasetMeta[]>([])
  const [linked, setLinked] = useState<MarketDataset | null>(null)
  // Entry default: last close of the imported CSV whose last candle is the most recent (no network).
  const [latestClose, setLatestClose] = useState<{ price: number; date: string; source: string } | null>(null)
  const [entrySource, setEntrySource] = useState('')
  const [quoteBusy, setQuoteBusy] = useState(false)
  useEffect(() => {
    let current = true
    api.datasets().then(async ({ datasets: list }) => {
      if (!current) return
      setDatasets(list)
      const newest = [...list].sort((a, b) => candleTime(b.lastDate, b.tzOffset ?? '+00:00') - candleTime(a.lastDate, a.tzOffset ?? '+00:00'))[0]
      if (!newest) return
      const { dataset } = await api.dataset(newest.id)
      if (!current) return
      const last = dataset.candles[dataset.candles.length - 1]
      setLatestClose({ price: last.close, date: last.date, source: dataset.sourceName })
    }).catch((e: unknown) => current && onError(getError(e)))
    return () => { current = false }
  }, [onError])
  const csvSourceText = (c: { date: string; source: string }) => t('scenario.csvDefault', { source: c.source, date: c.date })
  useEffect(() => {
    // Fill only an empty Entry; never overwrite what the user typed.
    if (!latestClose) return
    setDraft((old) => (old.entry === '' ? { ...old, entry: String(latestClose.price) } : old))
    setEntrySource((old) => old || csvSourceText(latestClose))
  }, [latestClose])

  async function fetchCurrentPrice() {
    setQuoteBusy(true)
    try {
      const { quote } = await api.quote()
      patch('entry', String(quote.price))
      setEntrySource(quote.provider === 'synthetic'
        ? `${quote.source} ${quote.asOf}`
        : t('scenario.quoteSource', { date: quote.asOf, source: quote.source }))
    } catch (e) { onError(getError(e)) }
    finally { setQuoteBusy(false) }
  }
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
  // Auto draft (deterministic rules on the user's CSV up to the as-of candle; direction = user's choice).
  const [method, setMethod] = useState<LevelMethod>('SWING')
  const [draftR, setDraftR] = useState(2)
  const levelDraft = linked && asOfIndex >= 0 ? draftLevels(linked.candles, asOfIndex, draft.side, method, draftR, linked.timeframe, getLang()) : null
  const stopSideOk = Number.isFinite(entry) && Number.isFinite(stop) && entry > 0 && stop > 0 &&
    (draft.side === 'LONG' ? stop < entry : stop > entry)
  const isAutoText = (text: string) => text.trim() === '' || AUTO_DRAFT_PREFIXES.some((p) => text.startsWith(p))
  const isAutoInvalidation = (text: string) => /^[\d.]+ を(下|上)回ったら仮説は無効$|^Invalid if price (falls below|rises above) [\d.]+$/.test(text)
  function applyDraft() {
    if (!levelDraft) return
    requestKey.current = null
    setEntrySource(t('scenario.draftSource', { date: levelDraft.facts.asOfDate }))
    setDraft((old) => ({
      ...old,
      entry: String(levelDraft.entry),
      stop: String(levelDraft.stop),
      target: String(levelDraft.target),
      thesis: isAutoText(old.thesis) ? levelDraft.thesisDraft : old.thesis,
      invalidation: isAutoText(old.invalidation) || isAutoInvalidation(old.invalidation) ? levelDraft.invalidationDraft : old.invalidation,
    }))
  }
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
      onError(`${issue?.path.join('.') || t('scenario.inputField')}: ${issue?.message ?? t('scenario.checkInput')}`)
      return
    }
    setBusy(true)
    requestKey.current ??= newRequestKey()
    try {
      const { scenario } = await api.create(parsed.data, requestKey.current)
      requestKey.current = null
      setDraft({ ...blankDraft, entry: latestClose ? String(latestClose.price) : '' })
      setEntrySource(latestClose ? csvSourceText(latestClose) : '')
      onCreated(scenario)
    } catch (e) { onError(getError(e)) }
    finally { setBusy(false) }
  }

  return (
    <section className="panel" aria-labelledby="scenario-title">
      <div className="section-head">
        <div><span className="eyebrow">02 / STRUCTURE THE THESIS</span><h2 id="scenario-title">New Scenario</h2><p>{t('scenario.intro')}</p></div>
        <span className="tag">USD/JPY · INITIAL SCOPE</span>
      </div>
      <form onSubmit={(e) => void submit(e)} className="scenario-form" aria-label={t('scenario.formAria')}>
        <div className="form-grid">
          <label>{t('scenario.pair')}<input value="USD/JPY" readOnly /></label>
          <label>{t('common.timeframe')}<select name="timeframe" value={draft.timeframe} onChange={(e) => patch('timeframe', e.currentTarget.value as Draft['timeframe'])}>
            <option value="1h">{t('common.tf.1h')}</option><option value="4h">{t('common.tf.4h')}</option><option value="1d">{t('common.tf.1d')}</option>
          </select></label>
          <fieldset className="side-toggle">
            <legend>{t('scenario.side')}</legend>
            <label className={draft.side === 'LONG' ? 'on long' : ''}><input type="radio" name="side" value="LONG" checked={draft.side === 'LONG'} onChange={() => patch('side', 'LONG')} />{t('scenario.long')}</label>
            <label className={draft.side === 'SHORT' ? 'on short-side' : ''}><input type="radio" name="side" value="SHORT" checked={draft.side === 'SHORT'} onChange={() => patch('side', 'SHORT')} />{t('scenario.short')}</label>
          </fieldset>
        </div>
        <fieldset className="market-link" data-testid="market-link">
          <legend>{t('scenario.linkLegend')}</legend>
          <div className="form-grid two">
            <label>{t('scenario.linkCsv')}<select name="datasetId" value={draft.datasetId} onChange={(e) => { patch('asOfDate', ''); patch('datasetId', e.currentTarget.value) }}>
              <option value="">{t('scenario.noLink')}</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.sourceName} · {d.timeframe} · {d.firstDate}→{d.lastDate}</option>)}
            </select></label>
            <label>{t('scenario.asOf')}<select name="asOfDate" value={draft.asOfDate} disabled={!linked} onChange={(e) => patch('asOfDate', e.currentTarget.value)}>
              {!linked && <option value="">—</option>}
              {asOfOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select></label>
          </div>
          {datasets.length === 0 && <p className="muted small">{t('scenario.linkHelp')}</p>}
          {linked && asOfCandle && (
            <>
              <div className="as-of-hint">
                <span>{t('scenario.asOfClose')}<strong data-testid="as-of-close">{price(asOfCandle.close)}</strong></span>
                <button type="button" className="secondary" onClick={() => { patch('entry', String(asOfCandle.close)); setEntrySource(t('scenario.asOfSource', { date: asOfCandle.date })) }}>{t('scenario.useAsEntry')}</button>
              </div>
              <div className="auto-draft" data-testid="auto-draft">
                <div className="auto-draft-head">
                  <strong>{t('scenario.autoDraft')}</strong>
                  <span className="muted small">{t('scenario.autoDraftNote', { side: draft.side })}</span>
                </div>
                <div className="auto-draft-controls">
                  <div className="segmented" role="group" aria-label={t('scenario.stopMethodAria')}>
                    <button type="button" aria-pressed={method === 'SWING'} className={method === 'SWING' ? 'selected' : ''} onClick={() => setMethod('SWING')}>{draft.side === 'LONG' ? t('scenario.stopSwingLong') : t('scenario.stopSwingShort')}</button>
                    <button type="button" aria-pressed={method === 'ATR'} className={method === 'ATR' ? 'selected' : ''} onClick={() => setMethod('ATR')}>ATR×1.5</button>
                  </div>
                  <div className="segmented" role="group" aria-label={t('scenario.targetRAria')}>
                    {[1.5, 2, 3].map((r) => <button key={r} type="button" aria-pressed={draftR === r} className={draftR === r ? 'selected' : ''} onClick={() => setDraftR(r)}>{r}R</button>)}
                  </div>
                </div>
                {levelDraft ? (
                  <div className="auto-draft-result">
                    <span data-testid="draft-levels">Entry <strong>{price(levelDraft.entry)}</strong> / Stop <strong>{price(levelDraft.stop)}</strong> / Target <strong>{price(levelDraft.target)}</strong></span>
                    <button type="button" className="primary" onClick={applyDraft}>{t('scenario.applyDraft')}</button>
                  </div>
                ) : (
                  <p className="muted small" data-testid="draft-unavailable">{method === 'ATR' ? t('scenario.atrUnavailable') : t('scenario.swingUnavailable')}</p>
                )}
                <p className="muted small">{t('scenario.rules', { stop: method === 'ATR' ? t('scenario.ruleAtr') : t(draft.side === 'LONG' ? 'scenario.ruleSwingLong' : 'scenario.ruleSwingShort', { n: levelDraft?.facts.lookback ?? 20 }), r: draftR })}</p>
              </div>
              <PriceChart
                candles={linked.candles.slice(Math.max(0, asOfIndex - 59), asOfIndex + 1)}
                label={t('scenario.linkChart')}
                levels={directional ? { entry, stop, target } : undefined}
                testId="link-chart"
              ranges
              />
              <p className="muted small">{t('scenario.linkImmutable')}</p>
            </>
          )}
        </fieldset>
        <div className="form-grid price-grid">
          <label>{t('scenario.entry')}<input name="entry" type="number" inputMode="decimal" step="any" min="0.001" placeholder="150.200" required value={draft.entry} onInput={(e) => { setEntrySource(''); patch('entry', e.currentTarget.value) }} /></label>
          <label>{t('scenario.stop')}<input name="stop" type="number" inputMode="decimal" step="any" min="0.001" placeholder="149.600" required value={draft.stop} onInput={(e) => patch('stop', e.currentTarget.value)} /></label>
          <label>{t('scenario.target')}<input name="target" type="number" inputMode="decimal" step="any" min="0.001" placeholder="151.400" required value={draft.target} onInput={(e) => patch('target', e.currentTarget.value)} /></label>
        </div>
        <div className="entry-source">
          <span data-testid="entry-source">{entrySource || t('scenario.entryHint')}</span>
          {quoteProvider !== 'off' && (
            <button type="button" className="secondary" data-testid="fetch-quote" disabled={quoteBusy} onClick={() => void fetchCurrentPrice()}>
              {quoteBusy ? t('scenario.fetching') : quoteProvider === 'synthetic' ? t('scenario.fetchQuoteTest') : t('scenario.fetchQuote')}
            </button>
          )}
        </div>
        <div className={'ratio-preview' + (directionIssue ? ' invalid' : '')} data-testid="rr-preview" aria-live="polite">
          <span>{t('scenario.rr')}</span>
          <strong>{ratio !== null ? '1 : ' + ratio.toFixed(2) : directionIssue ? t('scenario.badDirection') : t('scenario.waiting')}</strong>
          <span>{draft.side === 'LONG' ? 'LONG: Stop < Entry < Target' : 'SHORT: Target < Entry < Stop'}</span>
        </div>
        <div className="r-presets" data-testid="r-presets">
          <span>{t('scenario.rPresets')}</span>
          {[1, 1.5, 2, 3].map((r) => (
            <button key={r} type="button" className="secondary" disabled={!stopSideOk}
              onClick={() => patch('target', String(targetForR(draft.side, entry, stop, r)))}>{r}R</button>
          ))}
          {!stopSideOk && <small className="muted">{t('scenario.rPresetsHelp')}</small>}
        </div>
        <label>{t('scenario.thesis')}<textarea name="thesis" required minLength={12} maxLength={2000} rows={3} placeholder={t('scenario.thesisPh')} value={draft.thesis} onInput={(e) => patch('thesis', e.currentTarget.value)} /></label>
        <label>{t('scenario.invalidation')}<textarea name="invalidation" required minLength={5} maxLength={1000} rows={2} placeholder={t('scenario.invalidationPh')} value={draft.invalidation} onInput={(e) => patch('invalidation', e.currentTarget.value)} /></label>
        <div className="form-footer"><span>{t('scenario.footer')}</span><button className="primary" type="submit" disabled={busy}>{busy ? t('common.saving') : 'Save & challenge →'}</button></div>
      </form>

      <div className="divider" />
      <h3>{t('scenario.saved')} <span className="muted">{scenarios.length}</span></h3>
      {loading ? <div className="empty short" aria-busy="true">{t('common.loading')}</div>
        : scenarios.length === 0 ? <div className="empty short">{t('scenario.empty')}</div>
        : (
          <div className="table-wrap"><table className="responsive" data-testid="scenario-table">
            <thead><tr><th>{t('common.col.created')}</th><th>{t('common.col.side')}</th><th>{t('scenario.col.tf')}</th><th>Entry</th><th>Stop</th><th>Target</th><th>R:R</th><th>{t('scenario.col.thesis')}</th></tr></thead>
            <tbody>{scenarios.map((s) => (
              <tr key={s.id} onClick={() => onOpen(s.id)}>
                <td data-label={t('common.col.created')}>{timestamp(s.createdAt)}</td>
                <td data-label={t('common.col.side')}><span className={'side ' + (s.side === 'LONG' ? 'long' : 'short-side')}>{s.side}</span></td>
                <td data-label={t('scenario.col.tf')}>{s.timeframe}</td><td data-label="Entry">{price(s.entry)}</td><td data-label="Stop">{price(s.stop)}</td><td data-label="Target">{price(s.target)}</td>
                <td data-label="R:R">1:{s.riskReward.toFixed(2)}</td>
                <td data-label={t('scenario.col.thesis')} className="clip"><button className="link-button" type="button">{s.thesis}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
    </section>
  )
}
