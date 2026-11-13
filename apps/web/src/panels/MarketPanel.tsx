import { useEffect, useRef, useState } from 'preact/hooks'
import {
  MAX_CSV_BYTES,
  commonTzOffsets,
  parseOhlcCsv,
  summarizeCandles,
  type Candle,
  type MarketDataset,
  type MarketDatasetMeta,
} from '@tradecourt/core'
import { api, newRequestKey } from '../api'
import { PriceChart } from '../components/PriceChart'
import { getError, price, signed, timestamp } from '../format'
import { getLang, t } from '../i18n'

type Timeframe = '1h' | '4h' | '1d'
type Preview = { fileName: string; candles: Candle[] }

function Stats({ candles }: { candles: Candle[] }) {
  const s = summarizeCandles(candles)
  return (
    <div className="stat-grid four" data-testid="market-stats">
      <div className="mini-stat"><span>{t('market.lastClose')}</span><strong>{price(s.lastClose)}</strong><small>{s.lastDate}</small></div>
      <div className="mini-stat"><span>{t('market.high')}</span><strong data-testid="stat-high">{price(s.high)}</strong><small>{s.highDate}</small></div>
      <div className="mini-stat"><span>{t('market.low')}</span><strong data-testid="stat-low">{price(s.low)}</strong><small>{s.lowDate}</small></div>
      <div className="mini-stat"><span>{t('market.change')}</span><strong data-testid="stat-change" className={s.change >= 0 ? 'positive' : 'negative'}>{signed(s.changePct, 2)}%</strong><small>{signed(s.change, 3)} / {t('common.candles', { n: s.count })}</small></div>
    </div>
  )
}

export function MarketPanel() {
  const [datasets, setDatasets] = useState<MarketDatasetMeta[]>([])
  const [active, setActive] = useState<MarketDataset | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [timeframe, setTimeframe] = useState<Timeframe>('1d')
  const [sourceNote, setSourceNote] = useState('')
  // '' = not chosen yet (required), 'unknown' = user does not know (computed as UTC, flagged).
  const [tz, setTz] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const requestKey = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let mounted = true
    api.datasets().then(async ({ datasets: list }) => {
      if (!mounted) return
      setDatasets(list)
      if (list[0]) {
        const { dataset } = await api.dataset(list[0].id)
        if (mounted) setActive(dataset)
      }
    }).catch((e: unknown) => mounted && setError(getError(e)))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  async function readFile(file: File | undefined) {
    if (!file) return
    setError('')
    setPreview(null)
    requestKey.current = null
    if (file.size > MAX_CSV_BYTES) {
      setError(t('market.tooLarge'))
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    try {
      setPreview({ fileName: file.name, candles: parseOhlcCsv(await file.text()) })
    } catch (e) {
      setError(getError(e))
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function save() {
    if (!preview) return
    if (!tz) { setError(t('market.tzRequired')); return }
    setBusy(true); setError('')
    requestKey.current ??= newRequestKey()
    try {
      const { dataset } = await api.importDataset({
        symbol: 'USDJPY', timeframe, sourceName: preview.fileName, sourceNote, candles: preview.candles,
        ...(tz !== 'unknown' ? { tzOffset: tz } : {}),
      }, requestKey.current)
      setActive(dataset)
      setDatasets((list) => [dataset, ...list.filter((d) => d.id !== dataset.id)])
      setPreview(null)
      setSourceNote('')
      requestKey.current = null
      if (fileInput.current) fileInput.current.value = ''
    } catch (e) { setError(getError(e)) }
    finally { setBusy(false) }
  }

  async function open(id: string) {
    setError('')
    try { setActive((await api.dataset(id)).dataset) } catch (e) { setError(getError(e)) }
  }

  return (
    <section className="panel" aria-labelledby="market-title">
      <div className="section-head">
        <div>
          <span className="eyebrow">01 / MARKET EVIDENCE</span>
          <h2 id="market-title">Market Lens · USD/JPY</h2>
          <p>{t('market.intro')}</p>
        </div>
        <span className="tag">CSV · NOT LIVE</span>
      </div>

      <div className="import-grid">
        <label className="dropzone">
          <strong>{t('market.choose')}</strong>
          <span>{t('market.format')}</span>
          <input ref={fileInput} data-testid="csv-input" type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.currentTarget.files?.[0])} />
        </label>
        <div className="import-meta">
          <label>{t('market.symbol')}<input value="USD/JPY" readOnly /></label>
          <label>{t('common.timeframe')}<select value={timeframe} onChange={(e) => setTimeframe(e.currentTarget.value as Timeframe)}>
            <option value="1h">{t('common.tf.1h')}</option><option value="4h">{t('common.tf.4h')}</option><option value="1d">{t('common.tf.1d')}</option>
          </select></label>
          <label>{t('market.tzLabel')}<select data-testid="tz-select" value={tz} onChange={(e) => setTz(e.currentTarget.value)}>
            <option value="">{t('market.tzPlaceholder')}</option>
            {commonTzOffsets.map((o) => <option key={o.value} value={o.value}>{o.label[getLang()]}</option>)}
            <option value="unknown">{t('market.tzUnknown')}</option>
          </select></label>
          <label>{t('market.sourceNote')}<input maxLength={500} placeholder={t('market.sourceNotePh')} value={sourceNote} onInput={(e) => setSourceNote(e.currentTarget.value)} /></label>
        </div>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}

      {preview && (
        <div className="market-data preview" data-testid="csv-preview">
          <div className="preview-head">
            <div><span className="eyebrow">{t('market.preview')}</span><h3>{t('market.previewTitle', { name: preview.fileName, n: preview.candles.length })}</h3></div>
            <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? t('common.saving') : t('market.save')}</button>
          </div>
          <Stats candles={preview.candles} />
          <PriceChart candles={preview.candles} label={t('market.closeLabel')} />
        </div>
      )}

      {loading ? <div className="empty short" aria-busy="true">{t('market.loadingSaved')}</div>
        : active && !preview ? (
          <div className="market-data" data-testid="active-dataset">
            <Stats candles={active.candles} />
            <PriceChart candles={active.candles} label={t('market.closeLabel')} />
            <dl className="provenance">
              <div><dt>{t('market.source')}</dt><dd data-testid="dataset-source">{t('market.sourceValue', { name: active.sourceName })}{active.sourceNote && ` — ${active.sourceNote}`}</dd></div>
              <div><dt>{t('market.period')}</dt><dd>{t('market.periodValue', { from: active.firstDate, to: active.lastDate, tf: active.timeframe, n: active.candleCount })}</dd></div>
              <div><dt>{t('market.time')}</dt><dd data-testid="dataset-tz">{active.tzOffset ? t('market.tzSet', { tz: active.tzOffset }) : t('market.tzUnset')}</dd></div>
              <div><dt>{t('market.importedAt')}</dt><dd>{timestamp(active.importedAt)}</dd></div>
            </dl>
            <p className="muted small">{t('market.unverified')}</p>
          </div>
        ) : !preview && (
          <div className="empty short">{t('market.empty')}</div>
        )}

      {datasets.length > 1 && (
        <div className="dataset-list">
          <h3>{t('market.history')}</h3>
          <div className="table-wrap"><table className="responsive" data-testid="dataset-table">
            <thead><tr><th>{t('market.source')}</th><th>{t('common.timeframe')}</th><th>{t('market.period')}</th><th>TZ</th><th>{t('market.col.count')}</th><th>{t('market.col.imported')}</th></tr></thead>
            <tbody>{datasets.map((d) => (
              <tr key={d.id} className={active?.id === d.id ? 'selected' : ''} onClick={() => void open(d.id)}>
                <td data-label={t('market.source')}><button className="link-button" type="button">{d.sourceName}</button></td><td data-label={t('common.timeframe')}>{d.timeframe}</td>
                <td data-label={t('market.period')}>{d.firstDate} → {d.lastDate}</td><td data-label="TZ">{d.tzOffset ? `UTC${d.tzOffset}` : t('market.tzNone')}</td>
                <td data-label={t('market.col.count')}>{d.candleCount}</td><td data-label={t('market.col.imported')}>{timestamp(d.importedAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </section>
  )
}
