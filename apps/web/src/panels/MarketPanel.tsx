import { useEffect, useRef, useState } from 'preact/hooks'
import {
  MAX_CSV_BYTES,
  parseOhlcCsv,
  summarizeCandles,
  type Candle,
  type MarketDataset,
  type MarketDatasetMeta,
} from '@tradecourt/core'
import { api, newRequestKey } from '../api'
import { chartPoints } from '../market'
import { getError, price, signed, timestamp } from '../format'

type Timeframe = '1h' | '4h' | '1d'
type Preview = { fileName: string; candles: Candle[] }

function MarketChart({ candles }: { candles: Candle[] }) {
  const closes = candles.map((c) => c.close)
  const max = Math.max(...closes)
  const min = Math.min(...closes)
  return (
    <div className="chart-wrap">
      <div className="chart-axis"><span>{price(max)}</span><span>終値（CSV）</span></div>
      <svg viewBox="0 0 640 200" preserveAspectRatio="none" role="img" aria-label="インポートしたCSVの終値推移" data-testid="close-chart">
        <line vector-effect="non-scaling-stroke" x1="0" y1="100" x2="640" y2="100" className="chart-grid" />
        <polyline vector-effect="non-scaling-stroke" points={chartPoints(candles)} fill="none" stroke="#6bceb6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
      <div className="chart-axis"><span>{price(min)}</span><span>{candles[0].date} → {candles[candles.length - 1].date}</span></div>
    </div>
  )
}

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
    setBusy(true); setError('')
    requestKey.current ??= newRequestKey()
    try {
      const { dataset } = await api.importDataset({
        symbol: 'USDJPY', timeframe, sourceName: preview.fileName, sourceNote, candles: preview.candles,
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
          <MarketChart candles={preview.candles} />
        </div>
      )}

      {loading ? <div className="empty short" aria-busy="true">保存済みデータを読み込み中…</div>
        : active && !preview ? (
          <div className="market-data" data-testid="active-dataset">
            <Stats candles={active.candles} />
            <MarketChart candles={active.candles} />
            <dl className="provenance">
              <div><dt>出典</dt><dd data-testid="dataset-source">手動インポート「{active.sourceName}」{active.sourceNote && ` — ${active.sourceNote}`}</dd></div>
              <div><dt>期間</dt><dd>{active.firstDate} → {active.lastDate}（{active.timeframe} / {active.candleCount}本 / タイムゾーンはCSV記載どおり・未検証）</dd></div>
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
          <div className="table-wrap"><table>
            <thead><tr><th>出典</th><th>時間足</th><th>期間</th><th>本数</th><th>取込</th></tr></thead>
            <tbody>{datasets.map((d) => (
              <tr key={d.id} className={active?.id === d.id ? 'selected' : ''} onClick={() => void open(d.id)}>
                <td><button className="link-button" type="button">{d.sourceName}</button></td><td>{d.timeframe}</td>
                <td>{d.firstDate} → {d.lastDate}</td><td>{d.candleCount}</td><td>{timestamp(d.importedAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </section>
  )
}
