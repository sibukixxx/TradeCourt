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

type Timeframe = '1h' | '4h' | '1d'
type Preview = { fileName: string; candles: Candle[] }

function Stats({ candles }: { candles: Candle[] }) {
  const s = summarizeCandles(candles)
  return (
    <div className="stat-grid four" data-testid="market-stats">
      <div className="mini-stat"><span>CSV最終行の終値</span><strong>{price(s.lastClose)}</strong><small>{s.lastDate}</small></div>
      <div className="mini-stat"><span>期間高値</span><strong data-testid="stat-high">{price(s.high)}</strong><small>{s.highDate}</small></div>
      <div className="mini-stat"><span>期間安値</span><strong data-testid="stat-low">{price(s.low)}</strong><small>{s.lowDate}</small></div>
      <div className="mini-stat"><span>騰落率（初回終値→最終終値）</span><strong data-testid="stat-change" className={s.change >= 0 ? 'positive' : 'negative'}>{signed(s.changePct, 2)}%</strong><small>{signed(s.change, 3)} / {s.count}本</small></div>
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
      setError('CSVファイルは2MB以下にしてください（読み込みを中止しました）')
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
    if (!tz) { setError('CSVの時刻のタイムゾーンを選択してください（不明なら「不明」）'); return }
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
          <p>手元のOHLC CSVを読み込み、終値推移と期間の高値・安値・騰落率を確認します。リアルタイム配信・価格取得はありません。</p>
        </div>
        <span className="tag">CSV · NOT LIVE</span>
      </div>

      <div className="import-grid">
        <label className="dropzone">
          <strong>OHLC CSVを選択</strong>
          <span>ヘッダーに date,open,high,low,close（順不同・他列は無視）/ 昇順・重複なし / 最大5,000行・2MB</span>
          <input ref={fileInput} data-testid="csv-input" type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.currentTarget.files?.[0])} />
        </label>
        <div className="import-meta">
          <label>銘柄<input value="USD/JPY" readOnly /></label>
          <label>時間足<select value={timeframe} onChange={(e) => setTimeframe(e.currentTarget.value as Timeframe)}>
            <option value="1h">1時間</option><option value="4h">4時間</option><option value="1d">日足</option>
          </select></label>
          <label>CSV時刻のタイムゾーン（必須）<select data-testid="tz-select" value={tz} onChange={(e) => setTz(e.currentTarget.value)}>
            <option value="">選択してください</option>
            {commonTzOffsets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="unknown">不明（UTCとして扱い、未検証と表示）</option>
          </select></label>
          <label>出典メモ（任意）<input maxLength={500} placeholder="例: 証券会社エクスポート / 合成データ" value={sourceNote} onInput={(e) => setSourceNote(e.currentTarget.value)} /></label>
        </div>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}

      {preview && (
        <div className="market-data preview" data-testid="csv-preview">
          <div className="preview-head">
            <div><span className="eyebrow">PREVIEW · 未保存</span><h3>{preview.fileName}（{preview.candles.length}本）</h3></div>
            <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : 'ローカルD1に保存'}</button>
          </div>
          <Stats candles={preview.candles} />
          <PriceChart candles={preview.candles} label="終値（CSV）" />
        </div>
      )}

      {loading ? <div className="empty short" aria-busy="true">保存済みデータを読み込み中…</div>
        : active && !preview ? (
          <div className="market-data" data-testid="active-dataset">
            <Stats candles={active.candles} />
            <PriceChart candles={active.candles} label="終値（CSV）" />
            <dl className="provenance">
              <div><dt>出典</dt><dd data-testid="dataset-source">手動インポート「{active.sourceName}」{active.sourceNote && ` — ${active.sourceNote}`}</dd></div>
              <div><dt>期間</dt><dd>{active.firstDate} → {active.lastDate}（{active.timeframe} / {active.candleCount}本）</dd></div>
              <div><dt>時刻</dt><dd data-testid="dataset-tz">{active.tzOffset ? `UTC${active.tzOffset}（取込時に指定・各足の始値時刻）` : '未指定（UTCとして計算・未検証）'}</dd></div>
              <div><dt>取込日時</dt><dd>{timestamp(active.importedAt)}</dd></div>
            </dl>
            <p className="muted small">価格の真偽・時刻・欠損は検証していません。これは現在値ではなく、ユーザーが用意したCSVの内容です。</p>
          </div>
        ) : !preview && (
          <div className="empty short">価格の推移は、CSVを読み込むまで表示されません。値動きを捏造しないため、デモチャートはありません。</div>
        )}

      {datasets.length > 1 && (
        <div className="dataset-list">
          <h3>取込履歴</h3>
          <div className="table-wrap"><table className="responsive" data-testid="dataset-table">
            <thead><tr><th>出典</th><th>時間足</th><th>期間</th><th>TZ</th><th>本数</th><th>取込</th></tr></thead>
            <tbody>{datasets.map((d) => (
              <tr key={d.id} className={active?.id === d.id ? 'selected' : ''} onClick={() => void open(d.id)}>
                <td data-label="出典"><button className="link-button" type="button">{d.sourceName}</button></td><td data-label="時間足">{d.timeframe}</td>
                <td data-label="期間">{d.firstDate} → {d.lastDate}</td><td data-label="TZ">{d.tzOffset ? `UTC${d.tzOffset}` : '未指定'}</td>
                <td data-label="本数">{d.candleCount}</td><td data-label="取込">{timestamp(d.importedAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </section>
  )
}
